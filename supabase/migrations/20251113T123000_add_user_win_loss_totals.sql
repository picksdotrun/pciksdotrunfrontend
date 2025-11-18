alter table if exists public.users
  add column if not exists win_count bigint not null default 0,
  add column if not exists loss_count bigint not null default 0,
  add column if not exists win_amount_wei numeric not null default 0,
  add column if not exists loss_amount_wei numeric not null default 0;
