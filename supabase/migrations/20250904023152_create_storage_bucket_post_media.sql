-- Create storage bucket for token images/metadata if missing
insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

-- Public read policy (optional; service role bypasses RLS for writes)
do $$ begin
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'Public read post-media'
  ) then
    create policy "Public read post-media"
      on storage.objects for select
      using ( bucket_id = 'post-media' );
  end if;
end $$;
