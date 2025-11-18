create table if not exists public.win_loss_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  user_wallet text not null,
  side text not null check (side in ('yes','no')),
  outcome text not null check (outcome in ('win','loss')),
  amount_wei numeric,
  unique (pick_id, user_wallet, outcome)
);

create index if not exists win_loss_events_user_id_idx on public.win_loss_events(user_id, created_at desc);
create index if not exists win_loss_events_pick_id_idx on public.win_loss_events(pick_id);

alter table if exists public.picks
  drop column if exists winning_wallets,
  drop column if exists losing_wallets,
  drop column if exists win_loss_synced_at;
