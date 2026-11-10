-- Optional setup, not a migration: requires pg_net and Supabase Vault.
-- Installing this file does not create or enable a cron job.
create table public.alpaca_fill_dispatch (
  connection_id uuid primary key references public.broker_connections(id) on delete cascade,
  request_id bigint,
  requested_at timestamptz,
  completed_at timestamptz,
  last_status integer,
  last_error text
);
alter table public.alpaca_fill_dispatch enable row level security;
revoke all on public.alpaca_fill_dispatch from public, anon, authenticated;
grant select on public.alpaca_fill_dispatch to service_role;

create function public.dispatch_alpaca_paper_fills()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  token text;
  connection record;
  dispatched integer := 0;
begin
  select decrypted_secret into strict base_url from vault.decrypted_secrets
    where name = 'zuri_fill_backend_url';
  select decrypted_secret into strict token from vault.decrypted_secrets
    where name = 'zuri_fill_reconciliation_secret';
  if base_url is null or base_url !~ '^https://[a-zA-Z0-9.-]+$'
      or token is null or octet_length(token) < 32 then
    raise exception 'Invalid paper fill scheduler configuration';
  end if;

  -- Prevent overlapping cron runs from enqueuing the same connections.
  if not pg_catalog.pg_try_advisory_xact_lock(185479431, 1) then
    raise exception 'Paper fill dispatch is already running';
  end if;

  update public.alpaca_fill_dispatch d
    set completed_at = now(), last_status = r.status_code,
        last_error = case
          when r.timed_out then 'Request timed out'
          when r.error_msg is not null then 'Request failed'
          when r.status_code is null or r.status_code < 200 or r.status_code >= 300 then 'HTTP request failed'
          else null
        end
    from net._http_response r
    where d.request_id = r.id and d.completed_at is null;
  update public.alpaca_fill_dispatch
    set completed_at = now(), last_status = null, last_error = 'No response received'
    where request_id is not null and completed_at is null
      and requested_at < now() - interval '3 minutes';

  insert into public.alpaca_fill_dispatch (connection_id)
    select id from public.broker_connections
    where broker = 'alpaca' and environment = 'paper'
    on conflict (connection_id) do nothing;

  for connection in
    select d.connection_id from public.alpaca_fill_dispatch d
    join public.broker_connections b on b.id = d.connection_id
    where b.broker = 'alpaca' and b.environment = 'paper'
      and (d.request_id is null or d.completed_at is not null)
    order by d.requested_at asc nulls first, d.connection_id
    limit 10
  loop
    update public.alpaca_fill_dispatch
      set request_id = net.http_post(
            url := base_url || '/internal/alpaca-paper/reconcile',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || token),
            body := jsonb_build_object('connection_id', connection.connection_id),
            timeout_milliseconds := 120000
          ),
          requested_at = now(), completed_at = null
      where connection_id = connection.connection_id;
    dispatched := dispatched + 1;
  end loop;
  return dispatched;
end;
$$;
revoke all on function public.dispatch_alpaca_paper_fills() from public, anon, authenticated, service_role;
