-- Create users table for wallet-based profiles
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  wallet text not null unique,
  username text null unique,
  picks_count bigint not null default 0
);

-- RLS policies (loose: anon can select/insert/update; tighten later if auth added)
alter table public.users enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='users' and policyname='Allow read for anon'
  ) then
    create policy "Allow read for anon" on public.users for select to anon using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='users' and policyname='Allow insert for anon'
  ) then
    create policy "Allow insert for anon" on public.users for insert to anon with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='users' and policyname='Allow update for anon'
  ) then
    create policy "Allow update for anon" on public.users for update to anon using (true) with check (true);
  end if;
end $$;

-- Index to support leaderboard sorting
create index if not exists idx_users_picks_count_desc on public.users (picks_count desc);

