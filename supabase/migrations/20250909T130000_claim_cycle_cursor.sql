-- Cursor table for claim-cycle function
create table if not exists public.claim_cycle_cursor (
  id boolean primary key default true,
  last_created_at timestamptz null,
  last_id uuid null
);

