-- Run only against an isolated database with Vault and mocked pg_net objects.
begin;
do $$
declare
  u uuid := '8c88cc87-84de-4e16-ad50-c16b5d920724';
  c uuid;
  first_request bigint;
  url_secret uuid;
  n integer;
begin
  insert into auth.users (id) values (u);
  insert into public.broker_connections (user_id, broker, environment, credentials_encrypted)
    values (u, 'alpaca', 'paper', 'test') returning id into c;
  url_secret := vault.create_secret('https://example.test', 'zuri_fill_backend_url');
  perform vault.create_secret(repeat('x', 32), 'zuri_fill_reconciliation_secret');
  n := public.dispatch_alpaca_paper_fills();
  select request_id into first_request from public.alpaca_fill_dispatch where connection_id = c;
  if n <> 1 or first_request is null or not exists (
    select 1 from net.test_requests where id = first_request
      and body ->> 'connection_id' = c::text
      and url = 'https://example.test/internal/alpaca-paper/reconcile'
      and timeout_milliseconds = 120000
  ) then raise exception 'Expected one correctly configured request'; end if;
  if public.dispatch_alpaca_paper_fills() <> 0 then
    raise exception 'Pending requests must not be duplicated';
  end if;
  insert into net._http_response (id, status_code, timed_out) values (first_request, 503, false);
  n := public.dispatch_alpaca_paper_fills();
  if n <> 1 or not exists (
    select 1 from public.alpaca_fill_dispatch
    where connection_id = c and request_id <> first_request
      and last_status = 503 and last_error = 'HTTP request failed'
  ) then raise exception 'Failed response must be recorded and retried'; end if;
  update public.alpaca_fill_dispatch set requested_at = now() - interval '4 minutes' where connection_id = c;
  n := public.dispatch_alpaca_paper_fills();
  if n <> 1 or not exists (
    select 1 from public.alpaca_fill_dispatch where connection_id = c and last_error = 'No response received'
  ) then raise exception 'Missing response must be recorded and retried'; end if;
  update public.broker_connections set environment = 'live' where id = c;
  update public.alpaca_fill_dispatch set requested_at = now() - interval '4 minutes' where connection_id = c;
  if public.dispatch_alpaca_paper_fills() <> 0 then
    raise exception 'Live connections must not be dispatched';
  end if;
  perform vault.update_secret(url_secret, 'http://example.test');
  begin
    perform public.dispatch_alpaca_paper_fills();
    raise exception 'Expected invalid scheduler configuration rejection';
  exception when raise_exception then
    if sqlerrm <> 'Invalid paper fill scheduler configuration' then raise; end if;
  end;
  if has_function_privilege('authenticated', 'public.dispatch_alpaca_paper_fills()', 'execute')
      or has_table_privilege('authenticated', 'public.alpaca_fill_dispatch', 'select') then
    raise exception 'Dispatch must not be accessible to authenticated clients';
  end if;
end;
$$;

do $$
declare
  i integer;
  u uuid;
begin
  perform vault.update_secret(
    (select id from vault.decrypted_secrets where name = 'zuri_fill_backend_url'),
    'https://example.test'
  );
  for i in 1..11 loop
    u := ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users (id) values (u);
    insert into public.broker_connections (user_id, broker, environment, credentials_encrypted)
      values (u, 'alpaca', 'paper', 'test');
  end loop;
  if public.dispatch_alpaca_paper_fills() <> 10 then
    raise exception 'One pass must be bounded to ten connections';
  end if;
  if public.dispatch_alpaca_paper_fills() <> 1 then
    raise exception 'Undispatched connections must not starve';
  end if;
end;
$$;
rollback;
