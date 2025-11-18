alter table if exists public.users
  add column if not exists trading_volume_wei numeric default 0 not null;

alter table if exists public.picks
  add column if not exists trading_volume_wei numeric default 0 not null;

create index if not exists users_trading_volume_idx on public.users(trading_volume_wei desc);
create index if not exists picks_trading_volume_idx on public.picks(trading_volume_wei desc);

create or replace function public.increment_creator_totals(
  p_pick_id uuid,
  p_creator_id uuid,
  p_volume_delta numeric,
  p_creator_fee_delta numeric
)
returns void
language plpgsql
security definer
as $$
begin
  if p_pick_id is not null then
    update public.picks
      set total_volume_wei = coalesce(total_volume_wei, 0) + coalesce(p_volume_delta, 0),
          trading_volume_wei = coalesce(trading_volume_wei, 0) + coalesce(p_volume_delta, 0),
          creator_fee_total_wei = coalesce(creator_fee_total_wei, 0) + coalesce(p_creator_fee_delta, 0)
      where id = p_pick_id;
  end if;

  if p_creator_id is not null then
    update public.users
      set total_volume_wei = coalesce(total_volume_wei, 0) + coalesce(p_volume_delta, 0),
          trading_volume_wei = coalesce(trading_volume_wei, 0) + coalesce(p_volume_delta, 0),
          creator_fee_total_wei = coalesce(creator_fee_total_wei, 0) + coalesce(p_creator_fee_delta, 0)
      where id = p_creator_id;
  end if;
end;
$$;
