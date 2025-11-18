-- Extend users table with profile metadata fields and follower tracking.
alter table public.users
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists avatar_bucket text,
  add column if not exists avatar_path text,
  add column if not exists bio text,
  add column if not exists followers jsonb not null default '[]'::jsonb,
  add column if not exists followers_count bigint not null default 0;

-- Helpful expression indexes for case-insensitive lookups.
create index if not exists idx_users_wallet_lower on public.users ((lower(wallet)));
create index if not exists idx_users_username_lower on public.users ((lower(username)));
