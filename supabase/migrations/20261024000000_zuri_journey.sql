-- Tracks each user's guided onboarding with Zuri and their chosen coaching mode.
create table if not exists public.zuri_journey (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phase text not null default 'intro' check (phase in ('intro', 'tour', 'mode', 'quiz', 'done')),
  mode text check (mode is null or mode in ('coach', 'assistant')),
  level text check (level is null or level in ('foundations', 'building', 'advancing')),
  quiz_score integer check (quiz_score is null or quiz_score between 0 and 10),
  completed_steps text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.zuri_journey enable row level security;

create policy "Users can read their own journey"
  on public.zuri_journey for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own journey"
  on public.zuri_journey for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own journey"
  on public.zuri_journey for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
