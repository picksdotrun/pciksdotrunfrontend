-- Add creator_id to picks and backfill from creator_wallet
alter table public.picks
  add column if not exists creator_id uuid references public.users(id) on delete set null;

update public.picks p
set creator_id = u.id
from public.users u
where p.creator_id is null and p.creator_wallet is not null and lower(u.wallet) = lower(p.creator_wallet);

create index if not exists idx_picks_creator_id on public.picks(creator_id);
