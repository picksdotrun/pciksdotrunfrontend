-- Align direct_messages schema with required notification trigger behavior.
alter table public.users
  add column if not exists notification_count integer not null default 0;

create or replace function public.update_notification_count_directly()
returns trigger
language plpgsql
as $$
begin
  update public.users
  set notification_count = coalesce(notification_count, 0) + 1
  where id = new.recipient_id;
  return new;
end;
$$;

drop trigger if exists update_notifications_on_message on public.direct_messages;
drop table if exists public.direct_messages cascade;

create table public.direct_messages (
  id uuid not null default gen_random_uuid (),
  sender_id uuid not null,
  recipient_id uuid not null,
  body text not null,
  created_at timestamp with time zone null default timezone ('utc'::text, now()),
  user_notification_status boolean null default false,
  constraint direct_messages_pkey primary key (id),
  constraint direct_messages_recipient_id_fkey foreign KEY (recipient_id) references users (id) on delete CASCADE,
  constraint direct_messages_sender_id_fkey foreign KEY (sender_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_direct_messages_created_at on public.direct_messages using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_direct_messages_notification on public.direct_messages using btree (recipient_id, user_notification_status) TABLESPACE pg_default;

create index IF not exists idx_direct_messages_recipient_id on public.direct_messages using btree (recipient_id) TABLESPACE pg_default;

create index IF not exists idx_direct_messages_sender_id on public.direct_messages using btree (sender_id) TABLESPACE pg_default;

create trigger update_notifications_on_message
after INSERT on direct_messages for EACH row when (new.user_notification_status = false)
execute FUNCTION update_notification_count_directly ();

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
