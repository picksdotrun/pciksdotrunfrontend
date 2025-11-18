alter table public.trades
  alter column occurred_at set default timezone('utc', now());

create or replace function public.set_trade_occurred_at()
returns trigger
language plpgsql
as $$
begin
  if new.occurred_at is null then
    new.occurred_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trades_occurred_at on public.trades;
create trigger trg_trades_occurred_at
before insert on public.trades
for each row execute function public.set_trade_occurred_at();
