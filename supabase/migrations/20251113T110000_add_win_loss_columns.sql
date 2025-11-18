alter table public.picks
  add column if not exists winning_wallets jsonb not null default '[]'::jsonb,
  add column if not exists losing_wallets jsonb not null default '[]'::jsonb,
  add column if not exists win_loss_synced_at timestamptz;

create index if not exists picks_win_loss_synced_idx on public.picks(win_loss_synced_at);
