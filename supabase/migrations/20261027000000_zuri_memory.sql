-- Zuri's memory: every message she sends or receives, plus what she has learned about each user.
-- Written only by the backend (service role); users can read and delete their own data.

create table if not exists public.zuri_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('greeting', 'guide', 'chat')),
  topic text,
  section text,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 4000),
  user_level text,
  created_at timestamptz not null default now()
);

create index if not exists zuri_messages_user_created_idx
  on public.zuri_messages (user_id, created_at desc);

create table if not exists public.zuri_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level text not null default 'unknown'
    check (level in ('unknown', 'beginner', 'developing', 'intermediate', 'advanced', 'expert')),
  explanation_style text not null default 'balanced'
    check (explanation_style in ('detailed', 'balanced', 'concise')),
  notes text[] not null default '{}',
  visit_count integer not null default 0,
  interactions integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.zuri_messages enable row level security;
alter table public.zuri_memory enable row level security;

create policy "Users can read their own Zuri messages"
  on public.zuri_messages for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own Zuri memory"
  on public.zuri_memory for select to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update policies: only the backend (service role) writes, so users cannot edit
-- what Zuri believes about them or forge conversation history.
