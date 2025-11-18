-- Add Privy identifiers and auth metadata to users table
alter table public.users
  add column if not exists privy_user_id text unique,
  add column if not exists auth_method text;

create index if not exists idx_users_privy_user_id on public.users (privy_user_id);
