-- Direct messaging table for user-to-user chats
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  user_notification_status boolean not null default false
);

create index if not exists idx_direct_messages_created_at on public.direct_messages (created_at desc);
create index if not exists idx_direct_messages_sender_id on public.direct_messages (sender_id);
create index if not exists idx_direct_messages_recipient_id on public.direct_messages (recipient_id);
create index if not exists idx_direct_messages_notification on public.direct_messages (recipient_id, user_notification_status);

alter table public.direct_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='direct_messages' and policyname='Allow read messages'
  ) then
    create policy "Allow read messages" on public.direct_messages for select to anon using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='direct_messages' and policyname='Allow insert messages'
  ) then
    create policy "Allow insert messages" on public.direct_messages for insert to anon with check (true);
  end if;
end $$;
