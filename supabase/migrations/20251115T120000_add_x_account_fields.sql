-- Add X account fields to users table
alter table if exists public.users
  add column if not exists x_handle text,
  add column if not exists x_user_id text;

do $$ begin
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_users_x_user_id'
  ) then
    create unique index idx_users_x_user_id on public.users (x_user_id) where x_user_id is not null;
  end if;
end $$;
