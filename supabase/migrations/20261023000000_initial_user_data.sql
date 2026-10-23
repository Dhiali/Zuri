create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (
    display_name is null
    or (char_length(btrim(display_name)) between 1 and 60)
  ),
  trading_experience text check (
    trading_experience is null
    or trading_experience in ('New to trading', 'Learning the basics', 'Experienced')
  ),
  primary_markets text[] not null default '{}'::text[]
    check (primary_markets <@ array['Stocks', 'Crypto', 'Forex', 'Commodities']::text[]),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  default_symbol text not null default 'BTCUSD'
    check (default_symbol ~ '^[A-Z0-9._/-]{1,20}$'),
  default_timeframe text not null default '15m'
    check (default_timeframe in ('1m', '5m', '15m', '1h', '4h', '1D', '1W')),
  color_theme text not null default 'Midnight'
    check (color_theme in ('Midnight', 'Graphite', 'Classic', 'High contrast')),
  language text not null default 'English'
    check (language in ('English', 'Deutsch', 'Français', 'Español')),
  time_zone text not null default 'UTC',
  compact_mode boolean not null default false,
  trade_confirmation_required boolean not null default true,
  default_order_type text not null default 'Market'
    check (default_order_type in ('Market', 'Limit', 'Stop', 'Stop Limit')),
  order_fill_policy text not null default 'FOK'
    check (order_fill_policy in ('FOK', 'IOC', 'GTC', 'DAY')),
  max_open_positions integer not null default 6
    check (max_open_positions between 1 and 100),
  allow_hedging boolean not null default false,
  auto_close_on_stop boolean not null default true,
  max_daily_loss_percent numeric(5, 2) not null default 2.00
    check (max_daily_loss_percent between 0 and 100),
  max_trade_risk_percent numeric(5, 2) not null default 0.75
    check (max_trade_risk_percent between 0 and 100),
  max_correlation_exposure_percent numeric(5, 2) not null default 35.00
    check (max_correlation_exposure_percent between 0 and 100),
  price_alerts_enabled boolean not null default true,
  execution_notifications_enabled boolean not null default true,
  journal_reminders_enabled boolean not null default true,
  desktop_notifications_enabled boolean not null default false,
  hide_account_values boolean not null default false,
  allow_data_exports boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9._/-]{1,20}$'),
  timeframe text not null
    check (timeframe in ('1m', '5m', '15m', '1h', '4h', '1D', '1W')),
  side text not null check (side in ('Watching', 'Long', 'Short')),
  setup text not null default '',
  entry_price numeric(20, 8) check (entry_price is null or entry_price > 0),
  stop_price numeric(20, 8) check (stop_price is null or stop_price > 0),
  target_price numeric(20, 8) check (target_price is null or target_price > 0),
  note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index journal_entries_user_created_at_idx
  on public.journal_entries (user_id, created_at desc);

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9._/-]{1,20}$'),
  position integer not null check (position >= 0),
  created_at timestamptz not null default pg_catalog.now(),
  unique (user_id, symbol),
  unique (user_id, position)
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(
      left(
        coalesce(
          nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
          nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
        ),
        60
      ),
      ''
    )
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select
  id,
  nullif(
    left(
      coalesce(
        nullif(btrim(raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(raw_user_meta_data ->> 'name'), '')
      ),
      60
    ),
    ''
  )
from auth.users
on conflict (id) do nothing;

insert into public.user_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.journal_entries enable row level security;
alter table public.watchlist_items enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can read their own preferences"
  on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own preferences"
  on public.user_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own preferences"
  on public.user_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can read their own journal entries"
  on public.journal_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own journal entries"
  on public.journal_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own journal entries"
  on public.journal_entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own journal entries"
  on public.journal_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own watchlist items"
  on public.watchlist_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own watchlist items"
  on public.watchlist_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own watchlist items"
  on public.watchlist_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own watchlist items"
  on public.watchlist_items for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select, insert, update, delete on public.journal_entries to authenticated;
grant select, insert, update, delete on public.watchlist_items to authenticated;

revoke all on public.profiles from anon;
revoke all on public.user_preferences from anon;
revoke all on public.journal_entries from anon;
revoke all on public.watchlist_items from anon;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
