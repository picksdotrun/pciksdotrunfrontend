-- Add resolution fields to picks and create user_predictions for tracking user results

-- picks: resolution
alter table if exists public.picks
  add column if not exists win_side text check (win_side in ('less','more','void')),
  add column if not exists resolved_at timestamptz,
  add column if not exists final_value text;

-- user_predictions table
create table if not exists public.user_predictions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pick_id uuid not null references public.picks(id) on delete cascade,
  wallet_address text,
  side text not null check (side in ('less','more')),
  amount_sol numeric,
  tx_signature text,
  status text default 'open', -- open | closed | void
  result text,                -- won | lost | void
  resolved_at timestamptz
);

-- updated_at trigger for user_predictions
do $$ begin
  if not exists (
    select 1 from information_schema.triggers
    where event_object_table = 'user_predictions' and trigger_name = 'trg_user_predictions_updated_at'
  ) then
    create trigger trg_user_predictions_updated_at
    before update on public.user_predictions
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- Indexes
create index if not exists idx_user_predictions_profile_id on public.user_predictions (profile_id);
create index if not exists idx_user_predictions_pick_id on public.user_predictions (pick_id);

-- RLS
alter table public.user_predictions enable row level security;

do $$ begin
  -- allow public read (analytics, profiles); writes via service role only
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'user_predictions' and policyname = 'Public read user_predictions'
  ) then
    create policy "Public read user_predictions" on public.user_predictions for select using (true);
  end if;
end $$;

