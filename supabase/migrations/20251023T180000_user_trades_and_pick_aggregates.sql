-- Create user_trades table to log swaps
create table if not exists public.user_trades (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  user_wallet text not null,
  side text not null check (side in ('less','more')),
  amount_sol numeric not null default 0
);

create index if not exists idx_user_trades_pick_id on public.user_trades (pick_id);
create index if not exists idx_user_trades_pick_side on public.user_trades (pick_id, side);

alter table public.user_trades enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_trades' and policyname='Allow insert for anon'
  ) then
    create policy "Allow insert for anon" on public.user_trades for insert to anon with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_trades' and policyname='Allow read for anon'
  ) then
    create policy "Allow read for anon" on public.user_trades for select to anon using (true);
  end if;
end $$;

-- Aggregates on picks (totals)
alter table if exists public.picks
  add column if not exists holders_total bigint default 0,
  add column if not exists volume_total numeric default 0,
  add column if not exists makers_count bigint default 0;

