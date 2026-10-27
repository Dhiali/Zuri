-- Zuri as an agent: permanent memory (facts + rolling summaries), proactive nudges and action logging.
-- Nothing here is ever trimmed automatically; rows only disappear when the user resets Zuri or deletes their account.

create table if not exists public.zuri_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'general'
    check (category in ('goal', 'worry', 'preference', 'knowledge_gap', 'trading_style', 'milestone', 'risk_habit', 'personal_context', 'lesson', 'general')),
  fact text not null check (char_length(fact) <= 400),
  importance smallint not null default 3 check (importance between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists zuri_facts_user_created_idx on public.zuri_facts (user_id, created_at desc);

create table if not exists public.zuri_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  message_count integer not null default 0,
  summary text not null check (char_length(summary) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists zuri_summaries_user_period_idx on public.zuri_summaries (user_id, period_end desc);

alter table public.zuri_memory
  add column if not exists lifetime_profile text not null default '',
  add column if not exists summarized_through timestamptz;

create table if not exists public.zuri_nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'alert')),
  title text not null check (char_length(title) <= 160),
  body text not null check (char_length(body) <= 800),
  symbol text,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  unique (user_id, dedupe_key)
);

create index if not exists zuri_nudges_user_created_idx on public.zuri_nudges (user_id, created_at desc);

-- Approvals, declines and walkthroughs are remembered too.
alter table public.zuri_messages drop constraint if exists zuri_messages_source_check;
alter table public.zuri_messages
  add constraint zuri_messages_source_check
  check (source in ('greeting', 'guide', 'chat', 'action', 'nudge'));

-- Carry over every note Zuri already wrote (the old 20-note cap is gone).
insert into public.zuri_facts (user_id, category, fact, importance)
select m.user_id, 'general', left(n.note, 400), 3
from public.zuri_memory m, unnest(m.notes) as n(note)
where not exists (
  select 1 from public.zuri_facts f where f.user_id = m.user_id and f.fact = left(n.note, 400)
);

alter table public.zuri_facts enable row level security;
alter table public.zuri_summaries enable row level security;
alter table public.zuri_nudges enable row level security;

create policy "Users can read their own Zuri facts"
  on public.zuri_facts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own Zuri summaries"
  on public.zuri_summaries for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own Zuri nudges"
  on public.zuri_nudges for select to authenticated
  using ((select auth.uid()) = user_id);

-- Only the backend (service role) writes, so users cannot edit what Zuri believes about them.
