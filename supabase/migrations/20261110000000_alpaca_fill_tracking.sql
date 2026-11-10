-- Service-only tracking state. The broker account number is retained separately
-- from the connection ID so replacing credentials cannot silently move a cursor
-- to a different account.
alter table public.journal_entries drop constraint journal_entries_side_check;
alter table public.journal_entries add constraint journal_entries_side_check
  check (side in ('Watching', 'Long', 'Short', 'Buy', 'Sell'));
alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
  check (source in ('manual', 'auto', 'confirmed_fill'));
alter table public.journal_entries add constraint journal_fill_side_check
  check ((source = 'confirmed_fill') = (side in ('Buy', 'Sell')));

create policy "Only the service can create confirmed fill entries"
  on public.journal_entries as restrictive for insert to authenticated
  with check (source <> 'confirmed_fill');
create policy "Only the service can change confirmed fill entries"
  on public.journal_entries as restrictive for update to authenticated
  using (source <> 'confirmed_fill') with check (source <> 'confirmed_fill');

alter table public.broker_connections
  add column fill_revision uuid not null default gen_random_uuid(),
  add column fill_tracking_since timestamptz not null default clock_timestamp();

create function public.refresh_broker_fill_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.credentials_encrypted is distinct from old.credentials_encrypted
      or new.environment is distinct from old.environment
      or new.broker is distinct from old.broker
      or new.account_label is distinct from old.account_label
      or new.user_id is distinct from old.user_id then
    new.fill_revision := gen_random_uuid();
  end if;
  if new.environment is distinct from old.environment
      or new.broker is distinct from old.broker
      or new.account_label is distinct from old.account_label
      or new.user_id is distinct from old.user_id then
    new.fill_tracking_since := clock_timestamp();
  end if;
  return new;
end;
$$;
create trigger broker_connections_fill_revision
  before update on public.broker_connections
  for each row execute function public.refresh_broker_fill_revision();
revoke all on function public.refresh_broker_fill_revision() from public, anon, authenticated;

create table public.alpaca_fill_cursors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.broker_connections(id) on delete set null,
  account_number text not null check (char_length(account_number) between 1 and 128),
  starts_at timestamptz not null default now(),
  cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_number)
);

create table public.alpaca_fill_records (
  id uuid primary key default gen_random_uuid(),
  cursor_id uuid not null references public.alpaca_fill_cursors(id) on delete cascade,
  activity_id text not null check (char_length(activity_id) between 1 and 256),
  order_id text not null check (char_length(order_id) between 1 and 128),
  symbol text not null check (symbol ~ '^[A-Z0-9._/-]{1,20}$'),
  side text not null check (side in ('buy', 'sell')),
  quantity numeric not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  price numeric not null check (price > 0 and price < 'Infinity'::numeric),
  filled_at timestamptz not null,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cursor_id, activity_id)
);

alter table public.alpaca_fill_cursors enable row level security;
alter table public.alpaca_fill_records enable row level security;
revoke all on public.alpaca_fill_cursors, public.alpaca_fill_records from public, anon, authenticated;
grant select, insert, update, delete on public.alpaca_fill_cursors, public.alpaca_fill_records to service_role;

-- A reconnect to the same account resumes its checkpoint. The initial cutoff is
-- the time tracking began for the connection, not the later first polling run.
create function public.ensure_alpaca_fill_cursor(
  p_connection_id uuid,
  p_connection_revision uuid,
  p_account_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.broker_connections%rowtype;
  cursor_id uuid;
begin
  select * into connection from public.broker_connections
    where id = p_connection_id for update;
  if not found or connection.broker <> 'alpaca' or connection.environment <> 'paper'
      or connection.fill_revision is distinct from p_connection_revision
      or connection.account_label is distinct from p_account_number
      or p_account_number is null or char_length(p_account_number) not between 1 and 128 then
    raise exception 'Fill connection changed or account does not match';
  end if;
  insert into public.alpaca_fill_cursors (user_id, connection_id, account_number, starts_at)
    values (connection.user_id, connection.id, p_account_number, connection.fill_tracking_since)
    on conflict (user_id, account_number) do update
      set connection_id = excluded.connection_id
    returning id into cursor_id;
  return cursor_id;
end;
$$;
revoke all on function public.ensure_alpaca_fill_cursor(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_alpaca_fill_cursor(uuid, uuid, text) to service_role;

-- A page and its checkpoint must commit together. The expected cursor rejects
-- concurrent stale workers rather than allowing a cursor to move backwards.
create function public.save_alpaca_fill_page(
  p_cursor_id uuid,
  p_expected_cursor text,
  p_next_cursor text,
  p_fills jsonb,
  p_connection_revision uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.alpaca_fill_cursors%rowtype;
  item jsonb;
  inserted integer := 0;
  row_count integer;
  fill_id uuid;
  entry_id uuid;
  connection_id uuid;
begin
  select c.connection_id into connection_id from public.alpaca_fill_cursors c where c.id = p_cursor_id;
  perform 1 from public.broker_connections b
    where b.id = connection_id and b.broker = 'alpaca' and b.environment = 'paper'
      and b.fill_revision = p_connection_revision
    for share;
  if not found then
    raise exception 'Fill connection changed or is no longer an Alpaca paper connection';
  end if;
  select * into state from public.alpaca_fill_cursors where id = p_cursor_id for update;
  if not found or state.connection_id is distinct from connection_id
      or not exists (select 1 from public.broker_connections b where b.id = connection_id and b.user_id = state.user_id) then
    raise exception 'Fill cursor connection changed';
  end if;
  if state.cursor is distinct from p_expected_cursor then
    raise exception 'Fill cursor changed concurrently';
  end if;
  if jsonb_typeof(p_fills) is distinct from 'array' or jsonb_array_length(p_fills) = 0 then
    raise exception 'Fill page must be a non-empty array';
  end if;
  if jsonb_array_length(p_fills) > 100 or p_next_cursor is null
      or p_next_cursor is distinct from p_fills -> -1 ->> 'id'
      or p_next_cursor is not distinct from p_expected_cursor then
    raise exception 'Invalid fill page cursor';
  end if;
  for item in select value from jsonb_array_elements(p_fills) loop
    if jsonb_typeof(item) is distinct from 'object'
        or coalesce(item ->> 'id', '') = ''
        or coalesce(item ->> 'order_id', '') = ''
        or coalesce(item ->> 'symbol', '') !~ '^[A-Z0-9._/-]{1,20}$'
        or coalesce(item ->> 'side', '') not in ('buy', 'sell')
        or coalesce(item ->> 'time', '') = ''
        or item ->> 'quantity' is null or item ->> 'price' is null
        or not ((item ->> 'quantity')::numeric > 0 and (item ->> 'quantity')::numeric < 'Infinity'::numeric)
        or not ((item ->> 'price')::numeric > 0 and (item ->> 'price')::numeric < 'Infinity'::numeric) then
      raise exception 'Invalid fill activity';
    end if;
    if (item ->> 'time')::timestamptz >= state.starts_at then
      insert into public.alpaca_fill_records
        (cursor_id, activity_id, order_id, symbol, side, quantity, price, filled_at)
      values
        (p_cursor_id, item ->> 'id', item ->> 'order_id', item ->> 'symbol',
         item ->> 'side', (item ->> 'quantity')::numeric, (item ->> 'price')::numeric,
         (item ->> 'time')::timestamptz)
      on conflict (cursor_id, activity_id) do nothing
      returning id into fill_id;
      get diagnostics row_count = row_count;
      inserted := inserted + row_count;
      if row_count = 1 then
        insert into public.journal_entries
          (user_id, symbol, timeframe, side, setup, entry_price, note, source, created_at)
        values
          (state.user_id, item ->> 'symbol', '15m', initcap(item ->> 'side'),
           'Confirmed paper fill', (item ->> 'price')::numeric,
           format('Alpaca paper fill: %s %s %s at %s. Each partial fill is recorded separately.',
             item ->> 'side', item ->> 'quantity', item ->> 'symbol', item ->> 'price'),
           'confirmed_fill', (item ->> 'time')::timestamptz)
        returning id into entry_id;
        update public.alpaca_fill_records set journal_entry_id = entry_id where id = fill_id;
      end if;
    end if;
  end loop;
  update public.alpaca_fill_cursors
    set cursor = p_next_cursor, updated_at = now()
    where id = p_cursor_id;
  return inserted;
end;
$$;

revoke all on function public.save_alpaca_fill_page(uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_alpaca_fill_page(uuid, text, text, jsonb, uuid) to service_role;
