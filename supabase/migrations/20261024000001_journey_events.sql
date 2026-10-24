-- Records the user's whole trading journey (interest, orders, detected positions)
-- so Zuri can find leaks and analyse strategy. Rows are written by the backend.
create table if not exists public.journey_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'watchlist_add', 'watchlist_remove', 'symbol_viewed', 'order_placed', 'position_detected'
  )),
  symbol text check (symbol is null or symbol ~ '^[A-Z0-9._/-]{1,20}$'),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists journey_events_user_created_at_idx
  on public.journey_events (user_id, created_at desc);

alter table public.journey_events enable row level security;

create policy "Users can read their own journey events"
  on public.journey_events for select to authenticated
  using ((select auth.uid()) = user_id);

-- Marks journal rows Zuri created automatically from captured trades.
alter table public.journal_entries
  add column if not exists source text not null default 'manual'
  check (source in ('manual', 'auto'));
