-- Create table to queue and track scheduled future prop lookups
create table if not exists public.future_prop_requests (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  player text not null,
  team text,
  prop text not null,
  scope text not null default 'next_game', -- next_game | on_date
  date date,
  run_interval_minutes int not null default 60,
  enabled boolean not null default true,
  create_pick boolean not null default true,
  auto_launch boolean not null default false,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_line numeric,
  last_units text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_fpr_enabled_next_run on public.future_prop_requests (enabled, next_run_at);
create index if not exists idx_fpr_player_prop on public.future_prop_requests (player, prop);

-- Enable RLS and allow read-only for anon (UI can list), updates restricted to service role
alter table if exists public.future_prop_requests enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'future_prop_requests' and policyname = 'Allow read for anon'
  ) then
    create policy "Allow read for anon" on public.future_prop_requests for select to anon using (true);
  end if;
end $$;

