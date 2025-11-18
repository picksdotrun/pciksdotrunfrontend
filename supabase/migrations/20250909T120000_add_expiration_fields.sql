-- Add expiration and status fields to picks
alter table if exists public.picks
  add column if not exists expires_at timestamptz null,
  add column if not exists duration_sec integer null,
  add column if not exists status text null; -- open | expired | claiming | settled | failed

