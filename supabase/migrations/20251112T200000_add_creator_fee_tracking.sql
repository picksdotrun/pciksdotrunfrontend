create extension if not exists pgcrypto;

alter table public.picks
  add column if not exists total_volume_wei numeric default 0 not null,
  add column if not exists creator_fee_total_wei numeric default 0 not null;

alter table public.users
  add column if not exists total_volume_wei numeric default 0 not null,
  add column if not exists creator_fee_total_wei numeric default 0 not null;

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  tx_hash text not null,
  log_index integer not null,
  trader text,
  is_yes boolean,
  amount_wei numeric not null,
  shares_wei numeric,
  fee_wei numeric not null,
  creator_fee_wei numeric not null,
  block_number bigint,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tx_hash, log_index)
);

alter table public.trades enable row level security;

create index if not exists trades_pick_id_idx on public.trades(pick_id);
create index if not exists trades_tx_hash_idx on public.trades(tx_hash);

create policy "trades readable by anyone"
  on public.trades
  for select
  using (true);

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
          creator_fee_total_wei = coalesce(creator_fee_total_wei, 0) + coalesce(p_creator_fee_delta, 0)
      where id = p_pick_id;
  end if;

  if p_creator_id is not null then
    update public.users
      set total_volume_wei = coalesce(total_volume_wei, 0) + coalesce(p_volume_delta, 0),
          creator_fee_total_wei = coalesce(creator_fee_total_wei, 0) + coalesce(p_creator_fee_delta, 0)
      where id = p_creator_id;
  end if;
end;
$$;
