-- =====================================================================
-- Migration 004: freezes, refunds, day passes, duplicate-mobile checks,
-- all-or-nothing bill saving and collision-free receipt numbers.
-- Run this ONCE in the Supabase SQL Editor after 002 and 003.
-- Fresh installs only need schema.sql.
-- =====================================================================

-- 1. Day passes / trials are a plan type
alter table public.plans drop constraint if exists plans_kind_check;
alter table public.plans add constraint plans_kind_check check (kind in ('membership','personal_training','pass'));
alter table public.memberships drop constraint if exists memberships_kind_check;
alter table public.memberships add constraint memberships_kind_check check (kind in ('membership','personal_training','pass'));

-- 2. Normalised mobile number (last 10 digits) for duplicate checks and search
alter table public.members add column if not exists phone_digits      text generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored;
create index if not exists idx_members_phone_digits on public.members (owner_id, phone_digits);

-- ------------------------------- --------------------------------------
-- Membership freezes (pause). Freezing pushes the end date out by the
-- freeze length; the membership counts as frozen between start and end.
-- ---------------------------------------------------------------------
create table if not exists public.membership_freezes (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users on delete cascade,
  membership_id uuid not null references public.memberships on delete cascade,
  member_id     uuid not null references public.members on delete cascade,
  start_date    date not null,
  end_date      date not null,
  days          int  not null check (days > 0),
  reason        text,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- Refunds (money returned to a member). Reports subtract them; a refund
-- against a membership lowers what counts as paid on it.
-- ---------------------------------------------------------------------
create table if not exists public.refunds (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users on delete cascade,
  member_id     uuid not null references public.members on delete restrict,
  membership_id uuid references public.memberships on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  method        text not null default 'cash' check (method in ('cash','card','upi','bank','online','other')),
  refunded_on   date not null default current_date,
  reason        text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_freezes_membership   on public.membership_freezes (membership_id, start_date desc);
create index if not exists idx_refunds_owner_date   on public.refunds (owner_id, refunded_on desc);
create index if not exists idx_refunds_membership   on public.refunds (membership_id);

do $$
declare t text;
begin
  foreach t in array array['membership_freezes','refunds'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated
                    using (owner_id = (select auth.uid()))
                    with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;

-- 3. Views: paid is net of refunds; overview shows membership kind and current freeze
drop view if exists public.member_overview;
drop view if exists public.membership_balances;

-- Each membership with what has been paid against it (net of refunds) and the balance due
create or replace view public.membership_balances
with (security_invoker = true) as
select
  ms.*,
  coalesce(p.paid, 0) - coalesce(r.refunded, 0)                              as paid,
  coalesce(r.refunded, 0)                                                     as refunded,
  greatest(ms.price - ms.discount - (coalesce(p.paid, 0) - coalesce(r.refunded, 0)), 0) as balance
from public.memberships ms
left join (
  select membership_id, sum(amount) as paid
  from public.payments
  where membership_id is not null
  group by membership_id
) p on p.membership_id = ms.id
left join (
  select membership_id, sum(amount) as refunded
  from public.refunds
  where membership_id is not null
  group by membership_id
) r on r.membership_id = ms.id;

-- Each member with their latest membership
create or replace view public.member_overview
with (security_invoker = true) as
select
  m.*,
  t.full_name   as trainer_name,
  lm.id         as membership_id,
  lm.plan_name,
  lm.start_date as membership_start,
  lm.end_date   as membership_end,
  lm.status     as membership_status,
  lm.kind       as membership_kind,
  fz.start_date as freeze_start,
  fz.end_date   as freeze_end,
  coalesce(dues.balance, 0) as balance_due,
  dues.next_due_on,
  pt.plan_name    as pt_plan_name,
  pt.end_date     as pt_end,
  pt.trainer_name as pt_trainer_name,
  la.last_visit
from public.members m
left join public.trainers t on t.id = m.trainer_id
left join lateral (
  select * from public.memberships x
  where x.member_id = m.id and x.status <> 'cancelled' and x.kind in ('membership','pass')
  order by x.end_date desc
  limit 1
) lm on true
left join lateral (
  select f.start_date, f.end_date from public.membership_freezes f
  where f.membership_id = lm.id
  order by f.start_date desc
  limit 1
) fz on true
left join lateral (
  select x.plan_name, x.end_date, tr.full_name as trainer_name
  from public.memberships x
  left join public.trainers tr on tr.id = x.trainer_id
  where x.member_id = m.id and x.status = 'active' and x.kind = 'personal_training'
  order by x.end_date desc
  limit 1
) pt on true
left join lateral (
  select sum(b.balance) as balance,
         min(b.balance_due_on) filter (where b.balance > 0) as next_due_on
  from public.membership_balances b
  where b.member_id = m.id and b.status <> 'cancelled'
) dues on true
left join lateral (
  select max(a.check_in) as last_visit from public.attendance a where a.member_id = m.id
) la on true;

-- 4. Reports account for refunds, passes and freezes
-- Dashboard headline numbers in one round trip
create or replace function public.dashboard_stats(
  p_today date, p_alert_days int, p_day_start timestamptz, p_day_end timestamptz
) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'total_members',   (select count(*) from members where status <> 'inactive'),
    'active_members',  (select count(*) from member_overview
                         where status = 'active' and membership_status = 'active' and membership_kind = 'membership'
                           and membership_end >= p_today),
    'expiring',        (select count(*) from member_overview
                         where status = 'active' and membership_kind = 'membership'
                           and membership_end between p_today and p_today + p_alert_days),
    'expired',         (select count(*) from member_overview
                         where status <> 'inactive' and membership_kind = 'membership' and membership_end < p_today),
    'frozen_now',      (select count(*) from member_overview where freeze_start <= p_today and freeze_end >= p_today),
    'passes_today',    (select count(*) from memberships where kind = 'pass' and p_today between start_date and end_date),
    'new_members',     (select count(*) from members where joined_on >= date_trunc('month', p_today)::date),
    'checkins_today',  (select count(*) from attendance where check_in >= p_day_start and check_in < p_day_end),
    'inside_now',      (select count(*) from attendance
                         where check_in >= p_day_start and check_in < p_day_end and check_out is null),
    'revenue_month',   (select coalesce(sum(amount), 0) from payments
                         where paid_on between date_trunc('month', p_today)::date and p_today)
                     + (select coalesce(sum(total), 0) from sales
                         where sold_on between date_trunc('month', p_today)::date and p_today)
                     - (select coalesce(sum(amount), 0) from refunds
                         where refunded_on between date_trunc('month', p_today)::date and p_today),
    'revenue_today',   (select coalesce(sum(amount), 0) from payments where paid_on = p_today)
                     + (select coalesce(sum(total), 0) from sales where sold_on = p_today)
                     - (select coalesce(sum(amount), 0) from refunds where refunded_on = p_today),
    'refunds_month',   (select coalesce(sum(amount), 0) from refunds
                         where refunded_on between date_trunc('month', p_today)::date and p_today),
    'expenses_month',  (select coalesce(sum(amount), 0) from expenses
                         where spent_on between date_trunc('month', p_today)::date and p_today),
    'dues_total',      (select coalesce(sum(balance), 0) from membership_balances where status <> 'cancelled'),
    'dues_members',    (select count(distinct member_id) from membership_balances
                         where status <> 'cancelled' and balance > 0),
    'dues_overdue',    (select count(*) from membership_balances
                         where status <> 'cancelled' and balance > 0 and balance_due_on < p_today),
    'pt_clients',      (select count(distinct member_id) from memberships
                         where kind = 'personal_training' and status = 'active' and end_date >= p_today),
    'open_leads',      (select count(*) from leads where status in ('new','contacted','trial')),
    'followups_due',   (select count(*) from leads
                         where status in ('new','contacted','trial') and follow_up_on <= p_today),
    'low_stock',       (select count(*) from products where is_active and stock <= low_stock_level),
    'equipment_alerts',(select count(*) from equipment
                         where status in ('needs_service','out_of_order')
                            or (status = 'working' and next_service <= p_today + 7))
  );
$$;

-- Revenue (payments + POS sales) and expenses per month
create or replace function public.finance_monthly(p_from date, p_to date)
returns table (month date, payments numeric, sales numeric, expenses numeric)
language sql stable security invoker set search_path = public as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month
  )
  select m.month,
    coalesce((select sum(p.amount) from payments p
              where p.paid_on >= greatest(m.month, p_from)
                and p.paid_on <= least((m.month + interval '1 month - 1 day')::date, p_to)), 0)
    - coalesce((select sum(r.amount) from refunds r
              where r.refunded_on >= greatest(m.month, p_from)
                and r.refunded_on <= least((m.month + interval '1 month - 1 day')::date, p_to)), 0),
    coalesce((select sum(s.total) from sales s
              where s.sold_on >= greatest(m.month, p_from)
                and s.sold_on <= least((m.month + interval '1 month - 1 day')::date, p_to)), 0),
    coalesce((select sum(e.amount) from expenses e
              where e.spent_on >= greatest(m.month, p_from)
                and e.spent_on <= least((m.month + interval '1 month - 1 day')::date, p_to)), 0)
  from months m
  order by m.month;
$$;

-- Money in grouped by method and by category (POS sales count as category "product")
create or replace function public.payment_breakdown(p_from date, p_to date)
returns table (dimension text, key text, total numeric, entries bigint)
language sql stable security invoker set search_path = public as $$
  with money_in as (
    select method, category, amount from payments where paid_on between p_from and p_to
    union all
    select method, 'product', total from sales where sold_on between p_from and p_to
    union all
    select method, 'refund', -amount from refunds where refunded_on between p_from and p_to
  )
  select 'method', method, sum(amount), count(*) from money_in group by method
  union all
  select 'category', category, sum(amount), count(*) from money_in group by category;
$$;

-- Personal training per trainer: active PT clients and PT fees collected in range
create or replace function public.trainer_pt_stats(p_from date, p_to date, p_today date)
returns table (trainer_id uuid, clients bigint, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select t.id,
    (select count(distinct x.member_id) from memberships x
      where x.trainer_id = t.id and x.kind = 'personal_training'
        and x.status = 'active' and x.end_date >= p_today),
    (select coalesce(sum(p.amount), 0) from payments p
       join memberships x on x.id = p.membership_id
      where x.trainer_id = t.id and x.kind = 'personal_training'
        and p.paid_on between p_from and p_to)
    - (select coalesce(sum(r.amount), 0) from refunds r
       join memberships x on x.id = r.membership_id
      where x.trainer_id = t.id and x.kind = 'personal_training'
        and r.refunded_on between p_from and p_to)
  from trainers t;
$$;

-- ---------------------------------------------------------------------
-- Write functions. Each runs as one transaction: everything is saved or
-- nothing is. security invoker, so RLS still applies to every statement.
-- ---------------------------------------------------------------------

-- Insert payment rows that share one new receipt number. An advisory lock
-- per owner stops two simultaneous saves from getting the same number.
create or replace function public.record_payments(p_rows jsonb)
returns text
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_receipt text;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('receipt:' || coalesce(auth.uid()::text, '')));
  select 'R-' || lpad((coalesce(max(substring(receipt_no from 3)::int), 0) + 1)::text, 5, '0')
    into v_receipt
    from payments where receipt_no ~ '^R-[0-9]+$';
  insert into payments (member_id, membership_id, amount, method, category, paid_on, reference, notes, receipt_no)
  select (r->>'member_id')::uuid,
         nullif(r->>'membership_id', '')::uuid,
         (r->>'amount')::numeric,
         coalesce(r->>'method', 'cash'),
         coalesce(r->>'category', 'membership'),
         coalesce((r->>'paid_on')::date, current_date),
         nullif(r->>'reference', ''),
         nullif(r->>'notes', ''),
         v_receipt
    from jsonb_array_elements(p_rows) r;
  return v_receipt;
end $$;

-- One bill: memberships / PT / passes plus their payments (one receipt).
-- p_lines:    [{plan_id, plan_name, kind, trainer_id, sessions_total, start_date, end_date, price, discount, balance_due_on, notes}]
-- p_payments: [{line, amount, method, category, paid_on, reference}]   (line = index into p_lines)
-- p_close:    optional {id, end_date, discount, note} applied first (plan change / upgrade)
create or replace function public.save_bill(p_member_id uuid, p_lines jsonb, p_payments jsonb, p_close jsonb default null)
returns text
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_line jsonb;
  v_pay  jsonb;
  v_id   uuid;
  v_ids  uuid[] := '{}';
  v_rows jsonb := '[]'::jsonb;
begin
  if p_close is not null then
    update memberships
       set end_date = (p_close->>'end_date')::date,
           discount = (p_close->>'discount')::numeric,
           notes    = concat_ws(E'\n', nullif(notes, ''), nullif(p_close->>'note', ''))
     where id = (p_close->>'id')::uuid and member_id = p_member_id;
    if not found then
      raise exception 'The plan being changed was not found';
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into memberships (member_id, plan_id, plan_name, kind, trainer_id, sessions_total,
                             start_date, end_date, price, discount, balance_due_on, notes)
    values (p_member_id,
            nullif(v_line->>'plan_id', '')::uuid,
            v_line->>'plan_name',
            coalesce(v_line->>'kind', 'membership'),
            nullif(v_line->>'trainer_id', '')::uuid,
            nullif(v_line->>'sessions_total', '')::int,
            (v_line->>'start_date')::date,
            (v_line->>'end_date')::date,
            (v_line->>'price')::numeric,
            coalesce((v_line->>'discount')::numeric, 0),
            nullif(v_line->>'balance_due_on', '')::date,
            nullif(v_line->>'notes', ''))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_rows := v_rows || jsonb_build_array(
      v_pay || jsonb_build_object('member_id', p_member_id, 'membership_id', v_ids[(v_pay->>'line')::int + 1]));
  end loop;
  return record_payments(v_rows);
end $$;

-- Collect money against a fee: optional waive-off, new due date, payments.
create or replace function public.collect_fee(
  p_membership_id uuid, p_waive numeric, p_waive_note text, p_due_on date, p_rows jsonb
) returns text
language plpgsql volatile security invoker set search_path = public as $$
begin
  if p_membership_id is not null then
    update memberships
       set discount       = discount + coalesce(p_waive, 0),
           notes          = case when coalesce(p_waive, 0) > 0
                                 then concat_ws(E'\n', nullif(notes, ''), p_waive_note) else notes end,
           balance_due_on = p_due_on
     where id = p_membership_id;
  end if;
  return record_payments(p_rows);
end $$;

-- Pause a membership for p_days from p_start; the end date moves out by p_days.
create or replace function public.freeze_membership(p_membership_id uuid, p_start date, p_days int, p_reason text)
returns void
language plpgsql volatile security invoker set search_path = public as $$
begin
  if p_days is null or p_days < 1 then
    raise exception 'A freeze must be at least 1 day';
  end if;
  if exists (select 1 from membership_freezes f
              where f.membership_id = p_membership_id
                and f.start_date <= p_start + p_days - 1 and f.end_date >= p_start) then
    raise exception 'This membership already has a freeze in that period';
  end if;
  insert into membership_freezes (membership_id, member_id, start_date, end_date, days, reason)
  select id, member_id, p_start, p_start + p_days - 1, p_days, nullif(p_reason, '')
    from memberships where id = p_membership_id and status <> 'cancelled';
  if not found then
    raise exception 'Membership not found or cancelled';
  end if;
  update memberships set end_date = end_date + p_days where id = p_membership_id;
end $$;

-- End a freeze early (member resumes on p_resume). Unused freeze days are
-- taken back off the end date. Resuming on/before the start cancels it.
create or replace function public.unfreeze_membership(p_freeze_id uuid, p_resume date)
returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  f membership_freezes;
  v_unused int;
begin
  select * into f from membership_freezes where id = p_freeze_id;
  if not found then
    raise exception 'Freeze not found';
  end if;
  if p_resume > f.end_date then
    raise exception 'This freeze has already ended';
  end if;
  if p_resume <= f.start_date then
    v_unused := f.days;
    delete from membership_freezes where id = f.id;
  else
    v_unused := f.end_date - p_resume + 1;
    update membership_freezes set end_date = p_resume - 1, days = days - v_unused where id = f.id;
  end if;
  update memberships set end_date = end_date - v_unused where id = f.membership_id;
end $$;

-- Refund money on a membership / PT / pass, optionally cancelling it.
create or replace function public.refund_membership(
  p_membership_id uuid, p_amount numeric, p_method text, p_date date, p_reason text, p_cancel boolean
) returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  b membership_balances;
begin
  select * into b from membership_balances where id = p_membership_id;
  if not found then
    raise exception 'Membership not found';
  end if;
  if coalesce(p_amount, 0) > b.paid then
    raise exception 'Refund can''t be more than the % paid on this plan', b.paid;
  end if;
  if coalesce(p_amount, 0) > 0 then
    insert into refunds (member_id, membership_id, amount, method, refunded_on, reason)
    values (b.member_id, b.id, p_amount, coalesce(p_method, 'cash'), coalesce(p_date, current_date), nullif(p_reason, ''));
  end if;
  if p_cancel then
    update memberships
       set status = 'cancelled',
           balance_due_on = null,
           notes = concat_ws(E'\n', nullif(notes, ''),
                             'Cancelled on ' || coalesce(p_date, current_date) || coalesce(': ' || nullif(p_reason, ''), ''))
     where id = p_membership_id;
  end if;
end $$;
