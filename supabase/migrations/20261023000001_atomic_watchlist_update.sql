create function public.set_my_watchlist(p_symbols text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Sign in to update your watchlist.';
  end if;

  if pg_catalog.cardinality(coalesce(p_symbols, array[]::text[])) > 50 then
    raise exception 'A watchlist can contain at most 50 symbols.';
  end if;

  if exists (
    select symbol
    from pg_catalog.unnest(coalesce(p_symbols, array[]::text[])) as symbols(symbol)
    group by symbol
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'Watchlist symbols must be unique.';
  end if;

  delete from public.watchlist_items
  where user_id = current_user_id;

  insert into public.watchlist_items (user_id, symbol, position)
  select current_user_id, symbols.symbol, symbols.position::integer - 1
  from pg_catalog.unnest(coalesce(p_symbols, array[]::text[]))
    with ordinality as symbols(symbol, position);
end;
$$;

revoke all on function public.set_my_watchlist(text[]) from public, anon;
grant execute on function public.set_my_watchlist(text[]) to authenticated;
