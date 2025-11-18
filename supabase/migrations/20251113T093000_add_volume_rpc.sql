create or replace function public.total_pick_volume(p_pick_id uuid)
returns numeric
language plpgsql
security definer
as $$
declare
  total numeric := 0;
begin
  if p_pick_id is null then
    return 0;
  end if;
  select coalesce(sum(amount_wei), 0) into total from public.trades where pick_id = p_pick_id;
  return total;
end;
$$;

create or replace function public.total_user_volume(p_user_id uuid)
returns numeric
language plpgsql
security definer
as $$
declare
  total numeric := 0;
begin
  if p_user_id is null then
    return 0;
  end if;
  select coalesce(sum(amount_wei), 0) into total from public.trades where user_id = p_user_id;
  return total;
end;
$$;
