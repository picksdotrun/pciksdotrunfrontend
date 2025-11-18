-- Create post_comments table for pick conversations
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_notification_status boolean not null default false
);

create index if not exists idx_post_comments_pick_id on public.post_comments (pick_id);
create index if not exists idx_post_comments_user_id on public.post_comments (user_id);
create index if not exists idx_post_comments_notification on public.post_comments (user_notification_status);

create or replace function public.set_post_comments_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_post_comments_updated_at on public.post_comments;
create trigger trg_post_comments_updated_at
before update on public.post_comments
for each row
execute function public.set_post_comments_updated_at();

alter table public.post_comments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='post_comments' and policyname='Allow read for anon'
  ) then
    create policy "Allow read for anon" on public.post_comments for select to anon using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='post_comments' and policyname='Allow insert for anon'
  ) then
    create policy "Allow insert for anon" on public.post_comments for insert to anon with check (true);
  end if;
end $$;
