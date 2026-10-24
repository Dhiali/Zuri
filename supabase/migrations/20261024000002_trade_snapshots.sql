-- Chart snapshots Zuri captures when a trade is taken or closed, with AI annotations.
-- The chart is stored as candle data and rendered by the app, so it stays sharp and annotatable.
create table if not exists public.trade_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9._/-]{1,20}$'),
  kind text not null check (kind in ('entry', 'exit', 'detected')),
  side text,
  timeframe text not null default '15m',
  candles jsonb not null,
  markers jsonb not null default '{}'::jsonb,
  annotations jsonb not null default '[]'::jsonb,
  analysis text not null default '',
  screenshot text check (screenshot is null or (screenshot like 'data:image/jpeg;base64,%' and length(screenshot) < 2500000)),
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists trade_snapshots_user_created_at_idx
  on public.trade_snapshots (user_id, created_at desc);

alter table public.trade_snapshots enable row level security;

create policy "Users can read their own snapshots"
  on public.trade_snapshots for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can delete their own snapshots"
  on public.trade_snapshots for delete to authenticated
  using ((select auth.uid()) = user_id);
