-- Ensure picks_count column exists and backfill counts based on creator_id
alter table public.users
  add column if not exists picks_count bigint not null default 0;

update public.users u
set picks_count = coalesce(sub.count, 0)
from (
  select creator_id, count(*) as count
  from public.picks
  where creator_id is not null
  group by creator_id
) as sub
where u.id = sub.creator_id;
