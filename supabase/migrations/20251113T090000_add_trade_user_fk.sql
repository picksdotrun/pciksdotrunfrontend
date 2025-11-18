alter table public.trades
  add column if not exists user_id uuid references public.users(id) on delete set null;

create index if not exists trades_user_id_idx on public.trades(user_id);
create index if not exists trades_user_occurred_idx on public.trades(user_id, occurred_at desc);
