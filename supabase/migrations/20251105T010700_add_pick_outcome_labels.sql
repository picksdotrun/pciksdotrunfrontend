-- Adds optional outcome label/value fields for yes/no selections.
alter table if exists public.picks
  add column if not exists yes_label text,
  add column if not exists yes_value text,
  add column if not exists no_label text,
  add column if not exists no_value text;
