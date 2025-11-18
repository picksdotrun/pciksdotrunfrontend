-- Create user profile tables keyed by Privy user and wallet
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Privy user identifier (string), unique per user
  privy_user_id text unique,
  -- Primary wallet address for this user (Solana address), unique if present
  wallet_address text unique,
  -- Optional public display fields
  display_name text,
  avatar_url text,
  -- Arbitrary metadata for future extensibility
  metadata jsonb default '{}'::jsonb
);

-- Update trigger for updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Simple per-user settings record
create table if not exists public.user_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  preferences jsonb not null default '{}'::jsonb
);

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

-- Helpful indexes
create index if not exists idx_profiles_privy_user_id on public.profiles (privy_user_id);
create index if not exists idx_profiles_wallet_address on public.profiles (wallet_address);

-- Enable RLS with conservative defaults. Netlify/Supabase Edge functions
-- will use the service role and bypass RLS for writes.
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;

do $$ begin
  -- Allow public read of profiles (safe fields only). Consider tightening later.
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Public read profiles'
  ) then
    create policy "Public read profiles" on public.profiles for select using (true);
  end if;
  -- Public read of user_settings is disabled by default; only service role accesses it.
  -- No insert/update/delete policies are created intentionally; service role handles writes.
end $$;

