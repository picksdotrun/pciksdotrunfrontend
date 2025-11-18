-- Ensure a storage bucket without spaces for profile photos and permissive anon policies.
do $$ begin
  if not exists (
    select 1 from storage.buckets where id = 'profile-photos'
  ) then
    insert into storage.buckets (id, name, public)
    values ('profile-photos', 'profile-photos', true);
  end if;
end $$;

-- Allow public read access to the profile-photos bucket.
do $$ begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile-photos read'
  ) then
    create policy "profile-photos read"
      on storage.objects
      for select
      to public
      using (bucket_id = 'profile-photos');
  end if;
end $$;

-- Allow public inserts into the profile-photos bucket.
do $$ begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile-photos insert'
  ) then
    create policy "profile-photos insert"
      on storage.objects
      for insert
      to public
      with check (bucket_id = 'profile-photos');
  end if;
end $$;

-- Allow public updates (for upsert/replace) within the bucket.
do $$ begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile-photos update'
  ) then
    create policy "profile-photos update"
      on storage.objects
      for update
      to public
      using (bucket_id = 'profile-photos')
      with check (bucket_id = 'profile-photos');
  end if;
end $$;
