-- Allow anon to update token columns on picks
grant update (lesstoken, moretoken) on table public.picks to anon;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'picks' and policyname = 'Allow token update for anon'
  ) then
    create policy "Allow token update for anon" on public.picks for update to anon using (true) with check (true);
  end if;
end $$;
