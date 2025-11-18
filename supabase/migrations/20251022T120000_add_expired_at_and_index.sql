-- Add expired_at and helpful index for sweeper performance
alter table if exists public.picks
  add column if not exists expired_at timestamptz null;

-- Composite index to accelerate sweeps
do $$ begin
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_picks_status_expires_at'
  ) then
    create index idx_picks_status_expires_at on public.picks (status, expires_at);
  end if;
end $$;

