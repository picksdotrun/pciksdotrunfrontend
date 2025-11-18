-- Extend users table to support OAuth + email identifiers for Privy-authenticated logins.
alter table public.users
  add column if not exists oauth_identifier text unique,
  add column if not exists email text;

create index if not exists idx_users_oauth_identifier on public.users (oauth_identifier);
create index if not exists idx_users_email_lower on public.users ((lower(email)));
