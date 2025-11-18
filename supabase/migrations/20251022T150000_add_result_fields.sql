-- Add Grok result columns and index for unresolved closed picks
alter table if exists public.picks
  add column if not exists result text null, -- 'less' | 'more' | 'void'
  add column if not exists moderation_description text null,
  add column if not exists result_confidence numeric null,
  add column if not exists result_citations jsonb null,
  add column if not exists result_model text null,
  add column if not exists resolved_at timestamptz null,
  add column if not exists win_side text null;

do $$ begin
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_picks_closed_unresolved'
  ) then
    create index idx_picks_closed_unresolved on public.picks (expires_at) where status = 'closed' and result is null;
  end if;
end $$;

