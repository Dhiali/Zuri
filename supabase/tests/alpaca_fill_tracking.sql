-- Run against an isolated database after the broker connections and fill tracking migrations.
begin;

do $$
declare
  v_user_id uuid := '8c88cc87-84de-4e16-ad50-c16b5d920722';
  v_connection_id uuid;
  v_cursor_id uuid;
  v_revision uuid;
  n integer;
  old_fill jsonb := '{"id":"old","order_id":"order-1","symbol":"AAPL","side":"buy","quantity":1,"price":10,"time":"2026-01-01T00:00:00Z"}';
  first_fill jsonb := '{"id":"first","order_id":"order-1","symbol":"AAPL","side":"buy","quantity":0.4,"price":11,"time":"2026-02-01T00:00:00Z"}';
  second_fill jsonb := '{"id":"second","order_id":"order-1","symbol":"AAPL","side":"buy","quantity":0.6,"price":12,"time":"2026-02-01T00:00:01Z"}';
begin
  insert into auth.users (id) values (v_user_id);
  insert into public.broker_connections (user_id, broker, environment, credentials_encrypted)
    values (v_user_id, 'alpaca', 'paper', 'test') returning id, fill_revision into v_connection_id, v_revision;
  insert into public.alpaca_fill_cursors (user_id, connection_id, account_number, starts_at)
    values (v_user_id, v_connection_id, 'paper-account', '2026-01-15T00:00:00Z') returning id into v_cursor_id;

  n := public.save_alpaca_fill_page(v_cursor_id, null, 'first', jsonb_build_array(old_fill, first_fill), v_revision);
  if n <> 1 or (select count(*) from public.alpaca_fill_records where cursor_id = v_cursor_id) <> 1 then
    raise exception 'Historical fills must not be imported';
  end if;
  if (select count(*) from public.journal_entries where user_id = v_user_id) <> 1
      or not exists (
        select 1 from public.alpaca_fill_records f
        join public.journal_entries j on j.id = f.journal_entry_id
        where f.cursor_id = v_cursor_id and f.activity_id = 'first'
          and j.user_id = v_user_id and j.source = 'confirmed_fill' and j.side = 'Buy'
          and j.entry_price = 11 and j.created_at = '2026-02-01T00:00:00Z'::timestamptz
      ) then
    raise exception 'A confirmed fill must create one linked journal entry using actual fill facts';
  end if;
  n := public.save_alpaca_fill_page(v_cursor_id, 'first', 'second', jsonb_build_array(first_fill, second_fill), v_revision);
  if n <> 1 or (select sum(quantity) from public.alpaca_fill_records where cursor_id = v_cursor_id) <> 1 then
    raise exception 'Partial fills must be recorded once each';
  end if;
  if (select count(*) from public.journal_entries where user_id = v_user_id and source = 'confirmed_fill') <> 2
      or not exists (select 1 from public.journal_entries where user_id = v_user_id and note like '%0.6 AAPL at 12%') then
    raise exception 'Each distinct partial fill must create exactly one journal entry';
  end if;

  begin
    perform public.save_alpaca_fill_page(v_cursor_id, 'first', 'second', jsonb_build_array(second_fill), v_revision);
    raise exception 'Expected stale cursor rejection';
  exception when raise_exception then
    if sqlerrm <> 'Fill cursor changed concurrently' then raise; end if;
  end;
  begin
    perform public.save_alpaca_fill_page(v_cursor_id, 'second', 'bad', jsonb_build_array(
      '{"id":"third","order_id":"order-2","symbol":"AAPL","side":"sell","quantity":1,"price":10,"time":"2026-02-01T00:00:02Z"}'::jsonb,
      '{"id":"bad","order_id":"order-2","symbol":"AAPL","side":"buy","quantity":"NaN","price":10,"time":"2026-02-01T00:00:03Z"}'::jsonb
    ), v_revision);
    raise exception 'Expected invalid activity rejection';
  exception when raise_exception then
    if sqlerrm <> 'Invalid fill activity' then raise; end if;
  end;
  begin
    perform public.save_alpaca_fill_page(v_cursor_id, 'second', 'overflow', jsonb_build_array(
      '{"id":"third","order_id":"order-2","symbol":"AAPL","side":"sell","quantity":1,"price":10,"time":"2026-02-01T00:00:02Z"}'::jsonb,
      '{"id":"overflow","order_id":"order-2","symbol":"AAPL","side":"sell","quantity":1,"price":1000000000000,"time":"2026-02-01T00:00:03Z"}'::jsonb
    ), v_revision);
    raise exception 'Expected journal price overflow';
  exception when numeric_value_out_of_range then
    null;
  end;
  if (select cursor from public.alpaca_fill_cursors where id = v_cursor_id) <> 'second'
      or (select count(*) from public.alpaca_fill_records where cursor_id = v_cursor_id) <> 2
      or (select count(*) from public.journal_entries where user_id = v_user_id) <> 2 then
    raise exception 'Failed page must roll back records, journal entries and cursor';
  end if;
  n := public.save_alpaca_fill_page(v_cursor_id, 'second', 'third', jsonb_build_array(
    '{"id":"third","order_id":"order-2","symbol":"AAPL","side":"sell","quantity":1,"price":13,"time":"2026-02-01T00:00:02Z"}'::jsonb
  ), v_revision);
  if n <> 1 or not exists (
    select 1 from public.alpaca_fill_records f join public.journal_entries j on j.id = f.journal_entry_id
    where f.cursor_id = v_cursor_id and f.activity_id = 'third' and j.side = 'Sell' and j.entry_price = 13
  ) then
    raise exception 'Sell fills must retain their actual side and price';
  end if;
  delete from public.journal_entries where id = (
    select journal_entry_id from public.alpaca_fill_records where cursor_id = v_cursor_id and activity_id = 'third'
  );
  n := public.save_alpaca_fill_page(v_cursor_id, 'third', 'fourth', jsonb_build_array(
    '{"id":"third","order_id":"order-2","symbol":"AAPL","side":"sell","quantity":1,"price":13,"time":"2026-02-01T00:00:02Z"}'::jsonb,
    '{"id":"fourth","order_id":"order-3","symbol":"AAPL","side":"buy","quantity":1,"price":14,"time":"2026-02-01T00:00:03Z"}'::jsonb
  ), v_revision);
  if n <> 1 or (select count(*) from public.journal_entries where user_id = v_user_id) <> 3
      or (select journal_entry_id from public.alpaca_fill_records where cursor_id = v_cursor_id and activity_id = 'third') is not null then
    raise exception 'A repeated fill must not recreate a deleted journal entry';
  end if;
  if has_function_privilege('authenticated', 'public.save_alpaca_fill_page(uuid,text,text,jsonb,uuid)', 'execute')
      or has_table_privilege('authenticated', 'public.alpaca_fill_records', 'select')
      or not has_function_privilege('service_role', 'public.save_alpaca_fill_page(uuid,text,text,jsonb,uuid)', 'execute') then
    raise exception 'Fill tracking privileges are incorrect';
  end if;
  update public.broker_connections set credentials_encrypted = 'new credentials' where id = v_connection_id;
  begin
    perform public.save_alpaca_fill_page(v_cursor_id, 'fourth', 'fifth', jsonb_build_array(
      '{"id":"fifth","order_id":"order-4","symbol":"AAPL","side":"buy","quantity":1,"price":15,"time":"2026-02-01T00:00:04Z"}'::jsonb
    ), v_revision);
    raise exception 'Expected changed connection rejection';
  exception when raise_exception then
    if sqlerrm <> 'Fill connection changed or is no longer an Alpaca paper connection' then raise; end if;
  end;
  if (select cursor from public.alpaca_fill_cursors where id = v_cursor_id) <> 'fourth' then
    raise exception 'Changed credentials must not advance the old worker cursor';
  end if;
  update public.broker_connections set environment = 'live' where id = v_connection_id
    returning fill_revision into v_revision;
  begin
    perform public.save_alpaca_fill_page(v_cursor_id, 'fourth', 'fifth', jsonb_build_array(
      '{"id":"fifth","order_id":"order-4","symbol":"AAPL","side":"buy","quantity":1,"price":15,"time":"2026-02-01T00:00:04Z"}'::jsonb
    ), v_revision);
    raise exception 'Expected live connection rejection';
  exception when raise_exception then
    if sqlerrm <> 'Fill connection changed or is no longer an Alpaca paper connection' then raise; end if;
  end;
  delete from public.broker_connections where id = v_connection_id;
  if not exists (select 1 from public.alpaca_fill_cursors where id = v_cursor_id and connection_id is null)
      or (select count(*) from public.alpaca_fill_records where cursor_id = v_cursor_id) <> 4 then
    raise exception 'Disconnecting a broker must not erase recorded fills';
  end if;
  begin
    perform public.save_alpaca_fill_page(v_cursor_id, 'fourth', 'fifth', jsonb_build_array(
      '{"id":"fifth","order_id":"order-4","symbol":"AAPL","side":"buy","quantity":1,"price":15,"time":"2026-02-01T00:00:04Z"}'::jsonb
    ), v_revision);
    raise exception 'Expected disconnected connection rejection';
  exception when raise_exception then
    if sqlerrm <> 'Fill connection changed or is no longer an Alpaca paper connection' then raise; end if;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '8c88cc87-84de-4e16-ad50-c16b5d920722', true);
do $$
begin
  if (select count(*) from public.journal_entries where source = 'confirmed_fill') <> 3 then
    raise exception 'The owner must be able to read confirmed fills';
  end if;
  begin
    insert into public.journal_entries (user_id, symbol, timeframe, side, source)
    values ('8c88cc87-84de-4e16-ad50-c16b5d920722', 'AAPL', '15m', 'Buy', 'confirmed_fill');
    raise exception 'Expected forged fill rejection';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.journal_entries set note = 'forged' where source = 'confirmed_fill';
    if found then raise exception 'Expected confirmed fill update rejection'; end if;
  end;
  insert into public.journal_entries (user_id, symbol, timeframe, side, source)
    values ('8c88cc87-84de-4e16-ad50-c16b5d920722', 'AAPL', '15m', 'Watching', 'manual');
  update public.journal_entries set note = 'my note' where source = 'manual';
  if not found then raise exception 'Manual journal editing must still work'; end if;
  begin
    update public.journal_entries set source = 'confirmed_fill', side = 'Buy' where source = 'manual';
    raise exception 'Expected forged fill update rejection';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

do $$
declare
  v_user_id uuid := '8c88cc87-84de-4e16-ad50-c16b5d920723';
  v_connection uuid;
  v_revision uuid;
  v_cursor uuid;
  v_again uuid;
  v_starts_at timestamptz;
begin
  insert into auth.users (id) values (v_user_id);
  insert into public.broker_connections (user_id, broker, environment, account_label, credentials_encrypted)
    values (v_user_id, 'alpaca', 'paper', 'paper-account', 'test')
    returning id, fill_revision into v_connection, v_revision;
  update public.broker_connections set fill_tracking_since = '2026-02-01T00:00:00Z' where id = v_connection;
  v_cursor := public.ensure_alpaca_fill_cursor(v_connection, v_revision, 'paper-account');
  select starts_at into v_starts_at from public.alpaca_fill_cursors where id = v_cursor;
  if v_starts_at <> '2026-02-01T00:00:00Z'::timestamptz then
    raise exception 'First checkpoint must use connection tracking start, not provisioning time';
  end if;
  if public.save_alpaca_fill_page(v_cursor, null, 'during-delay', jsonb_build_array(
    '{"id":"during-delay","order_id":"order-1","symbol":"AAPL","side":"buy","quantity":1,"price":11,"time":"2026-02-01T00:01:00Z"}'::jsonb
  ), v_revision) <> 1 then
    raise exception 'Fill between tracking start and first poll must be imported';
  end if;
  update public.alpaca_fill_cursors set cursor = 'checkpoint' where id = v_cursor;
  v_again := public.ensure_alpaca_fill_cursor(v_connection, v_revision, 'paper-account');
  if v_again <> v_cursor or (select cursor from public.alpaca_fill_cursors where id = v_cursor) <> 'checkpoint' then
    raise exception 'Repeated provisioning must preserve checkpoint';
  end if;
  update public.broker_connections set credentials_encrypted = 'new' where id = v_connection;
  if (select fill_tracking_since from public.broker_connections where id = v_connection) <> v_starts_at then
    raise exception 'Credential refresh for the same account must preserve tracking start';
  end if;
  begin
    perform public.ensure_alpaca_fill_cursor(v_connection, v_revision, 'paper-account');
    raise exception 'Expected stale credential rejection';
  exception when raise_exception then
    if sqlerrm <> 'Fill connection changed or account does not match' then raise; end if;
  end;
  delete from public.broker_connections where id = v_connection;
  insert into public.broker_connections (user_id, broker, environment, account_label, credentials_encrypted)
    values (v_user_id, 'alpaca', 'paper', 'paper-account', 'replacement')
    returning id, fill_revision into v_connection, v_revision;
  v_again := public.ensure_alpaca_fill_cursor(v_connection, v_revision, 'paper-account');
  if v_again <> v_cursor or not exists (
    select 1 from public.alpaca_fill_cursors where id = v_cursor
      and connection_id = v_connection and cursor = 'checkpoint' and starts_at = v_starts_at
  ) then
    raise exception 'Relinking the same account must resume its checkpoint';
  end if;
  begin
    perform public.ensure_alpaca_fill_cursor(v_connection, v_revision, 'different-account');
    raise exception 'Expected account mismatch rejection';
  exception when raise_exception then
    if sqlerrm <> 'Fill connection changed or account does not match' then raise; end if;
  end;
  update public.broker_connections set account_label = 'different-account' where id = v_connection
    returning fill_revision into v_revision;
  v_again := public.ensure_alpaca_fill_cursor(v_connection, v_revision, 'different-account');
  if v_again = v_cursor then raise exception 'Different accounts must have separate checkpoints'; end if;
  if (select starts_at from public.alpaca_fill_cursors where id = v_again) <= v_starts_at then
    raise exception 'A new account must begin tracking when the account changes';
  end if;
  if has_function_privilege('authenticated', 'public.ensure_alpaca_fill_cursor(uuid,uuid,text)', 'execute')
      or not has_function_privilege('service_role', 'public.ensure_alpaca_fill_cursor(uuid,uuid,text)', 'execute') then
    raise exception 'Cursor provisioning privileges are incorrect';
  end if;
end;
$$;

rollback;
