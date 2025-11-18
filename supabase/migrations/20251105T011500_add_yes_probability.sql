alter table if exists public.picks
  add column if not exists yes_probability numeric;
