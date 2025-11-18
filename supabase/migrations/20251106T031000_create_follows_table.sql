-- Followers table to track creator relationships
create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.users(id) on delete cascade,
  follower_screen_name text not null,
  following_id uuid not null references public.users(id) on delete cascade,
  following_screen_name text not null,
  created_at timestamptz not null default now(),
  constraint no_self_follow check (follower_id <> following_id),
  constraint follows_follower_following_unique unique (follower_id, following_id)
);

create index if not exists idx_follows_created_at on public.follows (created_at desc);
create index if not exists idx_follows_follower_id on public.follows (follower_id);
create index if not exists idx_follows_following_id on public.follows (following_id);

create or replace function public.update_follower_counts()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update public.users
      set followers_count = greatest(coalesce(followers_count, 0) + 1, 0)
      where id = NEW.following_id;
  elsif TG_OP = 'DELETE' then
    update public.users
      set followers_count = greatest(coalesce(followers_count, 0) - 1, 0)
      where id = OLD.following_id;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_follow_counts on public.follows;
create trigger trg_follow_counts
after insert or delete on public.follows
for each row
execute function public.update_follower_counts();

alter table public.follows enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='follows' and policyname='Allow read follows'
  ) then
    create policy "Allow read follows" on public.follows for select to anon using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='follows' and policyname='Allow insert follows'
  ) then
    create policy "Allow insert follows" on public.follows for insert to anon with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='follows' and policyname='Allow delete follows'
  ) then
    create policy "Allow delete follows" on public.follows for delete to anon using (true);
  end if;
end $$;
