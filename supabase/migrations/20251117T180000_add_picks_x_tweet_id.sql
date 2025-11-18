-- Track the X tweet ID for each pick so downstream flows can reference the poll
alter table if exists public.picks
  add column if not exists x_tweet_id text;

create index if not exists idx_picks_x_tweet_id on public.picks (x_tweet_id);
