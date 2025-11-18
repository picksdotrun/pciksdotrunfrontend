-- Ensure users table tracks following metadata and keep metrics in sync
alter table public.users
  add column if not exists following jsonb not null default '[]'::jsonb,
  add column if not exists following_count bigint not null default 0;

create or replace function public.update_follow_metrics()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update public.users
      set followers_count = greatest(coalesce(followers_count, 0) + 1, 0),
          followers = coalesce(followers, '[]'::jsonb) || to_jsonb(NEW.follower_id)
      where id = NEW.following_id;

    update public.users
      set following_count = greatest(coalesce(following_count, 0) + 1, 0),
          following = coalesce(following, '[]'::jsonb) || to_jsonb(NEW.following_id)
      where id = NEW.follower_id;

  elsif TG_OP = 'DELETE' then
    update public.users
      set followers_count = greatest(coalesce(followers_count, 0) - 1, 0),
          followers = coalesce(
            (select jsonb_agg(elem)
             from jsonb_array_elements(coalesce(followers, '[]'::jsonb)) elem
             where elem <> to_jsonb(OLD.follower_id)
            ), '[]'::jsonb)
      where id = OLD.following_id;

    update public.users
      set following_count = greatest(coalesce(following_count, 0) - 1, 0),
          following = coalesce(
            (select jsonb_agg(elem)
             from jsonb_array_elements(coalesce(following, '[]'::jsonb)) elem
             where elem <> to_jsonb(OLD.following_id)
            ), '[]'::jsonb)
      where id = OLD.follower_id;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_follow_counts on public.follows;
create trigger trg_follow_counts
after insert or delete on public.follows
for each row
execute function public.update_follow_metrics();
