alter table if exists public.picks 
  add column if not exists lesspool text,
  add column if not exists morepool text;

