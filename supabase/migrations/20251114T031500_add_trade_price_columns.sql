alter table public.trades
  add column if not exists yes_price_bps integer,
  add column if not exists no_price_bps integer;

comment on column public.trades.yes_price_bps is 'YES trade price in basis points (0-10000 = 0%-100%)';
comment on column public.trades.no_price_bps is 'NO trade price in basis points (0-10000 = 0%-100%)';
