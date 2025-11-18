alter table public.picks
  add column if not exists evm_market_type text;
