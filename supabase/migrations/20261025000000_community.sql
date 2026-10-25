-- Opt-in trader community. Accessed only through the Zuri backend (service role),
-- so RLS is enabled with no client policies: nobody can read these tables directly.
create table if not exists public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[A-Za-z0-9_]{3,20}$'),
  strategies text[] not null default '{}' check (cardinality(strategies) <= 5),
  bio text not null default '' check (char_length(bio) <= 160),
  created_at timestamptz not null default now()
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.community_posts(id) on delete cascade,
  strategy text,
  body text not null check (char_length(body) between 1 and 600),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists community_posts_feed_idx on public.community_posts (strategy, created_at desc);
create index if not exists community_posts_parent_idx on public.community_posts (parent_id);

create table if not exists public.community_reports (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

alter table public.community_profiles enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_reports enable row level security;
