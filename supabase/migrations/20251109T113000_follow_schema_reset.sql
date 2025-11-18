-- Full follow schema reset so you only need to run one script.
-- 1) Ensures the follows table exists with the proper constraints.
-- 2) Adds following metadata columns to users if missing.
-- 3) Drops old triggers/functions so the edge function controls counts.

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.users(id) on delete cascade,
  follower_screen_name text not null,
  following_id uuid not null references public.users(id) on delete cascade,
  following_screen_name text not null,
  created_at timestamptz not null default now(),
  constraint follows_follower_following_unique unique (follower_id, following_id),
  constraint no_self_follow check (follower_id <> following_id)
);

create index if not exists idx_follows_created_at on public.follows (created_at desc);
create index if not exists idx_follows_follower_id on public.follows (follower_id);
create index if not exists idx_follows_following_id on public.follows (following_id);

alter table public.users
  add column if not exists followers_count bigint not null default 0,
  add column if not exists followers jsonb not null default '[]'::jsonb,
  add column if not exists following_count bigint not null default 0,
  add column if not exists following jsonb not null default '[]'::jsonb;

-- Drop any leftover triggers/functions so the edge function owns counts.
drop trigger if exists trg_follow_counts on public.follows;
drop function if exists public.update_follow_metrics();
drop function if exists public.update_follower_counts();
