-- Saves each user's chart scanners and backtest history to their account instead of one browser.
create table if not exists public.research_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('scanners', 'backtests')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) < 2000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.research_state enable row level security;

create policy "Users can read their own research state"
  on public.research_state for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own research state"
  on public.research_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own research state"
  on public.research_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own research state"
  on public.research_state for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Same email-link gate as the other user tables (restrictive policies combine with AND).
create policy "Email link required to create" on public.research_state
  as restrictive for insert to authenticated with check (public.email_link_ok());
create policy "Email link required to update" on public.research_state
  as restrictive for update to authenticated using (public.email_link_ok()) with check (public.email_link_ok());
