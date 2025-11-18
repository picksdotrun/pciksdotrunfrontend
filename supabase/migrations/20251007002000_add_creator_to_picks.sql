-- Add creator linkage to picks so creators can resolve their own picks

alter table if exists public.picks
  add column if not exists creator_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists creator_wallet text;

create index if not exists idx_picks_creator_profile_id on public.picks (creator_profile_id);

