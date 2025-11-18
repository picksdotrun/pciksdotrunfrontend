-- Add per-side metrics to picks: holders and volume for LESS and MORE
alter table if exists public.picks
  add column if not exists lessholders bigint default 0,
  add column if not exists moreholders bigint default 0,
  add column if not exists lessvolume numeric default 0,
  add column if not exists morevolume numeric default 0;

-- Optional: grant update on these columns to anon if using anon client
-- (Edge functions use service role; this grant is not required, but left commented.)
-- grant update (lessholders, moreholders, lessvolume, morevolume) on table public.picks to anon;

