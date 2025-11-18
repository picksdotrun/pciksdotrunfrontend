-- Ensure follows table, indexes, and trigger align with latest spec
create table if not exists public.follows (
  id uuid not null default gen_random_uuid(),
  follower_id uuid not null,
  follower_screen_name text not null,
  following_id uuid not null,
  following_screen_name text not null,
  created_at timestamptz not null default now(),
  constraint follows_pkey primary key (id),
  constraint follows_follower_following_unique unique (follower_id, following_id),
  constraint follows_follower_id_fkey foreign key (follower_id) references public.users(id) on delete cascade,
  constraint follows_following_id_fkey foreign key (following_id) references public.users(id) on delete cascade,
  constraint no_self_follow check (follower_id <> following_id)
);

create index if not exists idx_follows_created_at on public.follows using btree (created_at desc);
create index if not exists idx_follows_follower_id on public.follows using btree (follower_id);
create index if not exists idx_follows_following_id on public.follows using btree (following_id);

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
