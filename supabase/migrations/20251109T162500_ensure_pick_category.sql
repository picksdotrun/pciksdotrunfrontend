-- Ensure picks.category column exists and is normalized
alter table public.picks
  add column if not exists category text;

update public.picks
set category = case
    when category is null or trim(category) = '' then 'Sports'
    else category
  end;

alter table public.picks
  alter column category set default 'Sports';

update public.picks
set category = 'Sports'
where category is null;

alter table public.picks
  alter column category set not null;

create index if not exists idx_picks_category on public.picks (lower(category));
