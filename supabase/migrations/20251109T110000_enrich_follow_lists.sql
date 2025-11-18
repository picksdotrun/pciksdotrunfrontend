-- Store follower/following metadata as JSON objects and keep counts in sync
create or replace function public.update_follow_metrics()
returns trigger as $$
declare
  follower_obj jsonb;
  following_obj jsonb;
begin
  if TG_OP = 'INSERT' then
    follower_obj := jsonb_build_object('id', NEW.follower_id, 'screen_name', NEW.follower_screen_name);
    following_obj := jsonb_build_object('id', NEW.following_id, 'screen_name', NEW.following_screen_name);

    update public.users
      set followers_count = greatest(coalesce(followers_count, 0) + 1, 0),
          followers = coalesce(
            (select jsonb_agg(elem)
             from jsonb_array_elements(coalesce(followers, '[]'::jsonb)) elem
             where elem->>'id' <> NEW.follower_id::text),
            '[]'::jsonb
          ) || follower_obj
      where id = NEW.following_id;

    update public.users
      set following_count = greatest(coalesce(following_count, 0) + 1, 0),
          following = coalesce(
            (select jsonb_agg(elem)
             from jsonb_array_elements(coalesce(following, '[]'::jsonb)) elem
             where elem->>'id' <> NEW.following_id::text),
            '[]'::jsonb
          ) || following_obj
      where id = NEW.follower_id;

  elsif TG_OP = 'DELETE' then
    update public.users
      set followers_count = greatest(coalesce(followers_count, 0) - 1, 0),
          followers = coalesce(
            (select jsonb_agg(elem)
             from jsonb_array_elements(coalesce(followers, '[]'::jsonb)) elem
             where elem->>'id' <> OLD.follower_id::text),
            '[]'::jsonb
          )
      where id = OLD.following_id;

    update public.users
      set following_count = greatest(coalesce(following_count, 0) - 1, 0),
          following = coalesce(
            (select jsonb_agg(elem)
             from jsonb_array_elements(coalesce(following, '[]'::jsonb)) elem
             where elem->>'id' <> OLD.following_id::text),
            '[]'::jsonb
          )
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
