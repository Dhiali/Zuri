-- Per-user linked broker accounts. Credentials are encrypted by the backend
-- before storage and are only ever read with the service role key.
create table if not exists public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null check (broker in ('alpaca', 'oanda', 'tradier')),
  environment text not null check (environment in ('paper', 'live')),
  account_label text,
  credentials_encrypted text not null,
  created_at timestamptz not null default now(),
  unique (user_id, broker)
);

-- RLS is enabled with no policies: browser clients cannot read or write rows.
alter table public.broker_connections enable row level security;
revoke all on public.broker_connections from anon, authenticated;
