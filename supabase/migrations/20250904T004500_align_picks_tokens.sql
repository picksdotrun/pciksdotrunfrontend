-- Align picks schema with provided definition and ensure token columns exist
do $$ begin
  if not exists (
    select 1 from information_schema.tables 
    where table_schema = 'public' and table_name = 'picks'
  ) then
    create table public.picks (
      id uuid not null default gen_random_uuid(),
      created_at timestamptz not null default now(),
      name text not null,
      line text not null,
      category text not null,
      description text null,
      image text null,
      team text null,
      lesstoken text null,
      moretoken text null,
      constraint picks_pkey primary key (id)
    );
  end if;
end $$;

-- If table already existed, make sure token columns are present
alter table if exists public.picks 
  add column if not exists lesstoken text,
  add column if not exists moretoken text;

-- Ensure RLS policies exist (read + insert for anon)
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

