-- =====================================================================
-- Migration 003: sequential receipt numbers (one receipt per bill).
-- Run this ONCE in the Supabase SQL Editor after 002.
-- Fresh installs only need schema.sql.
-- =====================================================================

alter table public.payments add column if not exists receipt_no text;
create index if not exists idx_payments_receipt on public.payments (owner_id, receipt_no);

-- Number existing payments in date order, per owner
with numbered as (
  select id, row_number() over (partition by owner_id order by paid_on, created_at) as rn
  from public.payments
  where receipt_no is null
)
update public.payments p
   set receipt_no = 'R-' || lpad(n.rn::text, 5, '0')
  from numbered n
 where n.id = p.id
   and not exists (select 1 from public.payments x where x.receipt_no is not null and x.owner_id = p.owner_id);

-- Next sequential receipt number for the signed-in owner (R-00001, R-00002, ...)
create or replace function public.next_receipt_no()
returns text
language sql volatile security invoker set search_path = public as $$
  select 'R-' || lpad((coalesce(max(substring(receipt_no from 3)::int), 0) + 1)::text, 5, '0')
    from payments where receipt_no ~ '^R-[0-9]+$';
$$;
