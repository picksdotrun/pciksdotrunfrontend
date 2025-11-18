-- Create picks table for PICKS UI
create table if not exists public.picks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  line text not null,
  category text not null,
  description text,
  image text, -- stores data URL for now; consider moving to Storage later
  team text,
  lessToken text,
  moreToken text
);

-- RLS: allow read and insert for anon
alter table public.picks enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'picks' and policyname = 'Allow read for anon'
  ) then
    create policy "Allow read for anon" on public.picks for select to anon using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'picks' and policyname = 'Allow insert for anon'
  ) then
    create policy "Allow insert for anon" on public.picks for insert to anon with check (true);
  end if;
end $$;
