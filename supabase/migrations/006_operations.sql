-- =====================================================================
-- Migration 006: PT session log, salary history, counter-sale receipts and
-- credit sales, refund notes, shareable receipts, freeze rules, transfers,
-- equipment service history, recurring expenses, class bookings, and
-- consistent dashboard counts.
-- Run this ONCE in the Supabase SQL Editor after 005. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

-- 1. New columns
alter table public.gym_settings add column if not exists freeze_max_days int check (freeze_max_days > 0);
alter table public.gym_settings add column if not exists freeze_fee numeric(12,2) not null default 0 check (freeze_fee >= 0);
alter table public.payments add column if not exists share_token uuid not null default gen_random_uuid();
alter table public.expenses add column if not exists trainer_id uuid references public.trainers on delete set null;
alter table public.expenses add column if not exists bill_path text;
alter table public.sales add column if not exists receipt_no text;
alter table public.sales add column if not exists on_credit boolean not null default false;
alter table public.sales add column if not exists charge_id uuid references public.memberships on delete set null;
alter table public.sales add column if not exists share_token uuid not null default gen_random_uuid();
alter table public.refunds add column if not exists refund_no text;

-- One-off dues ("charge"): counter sale on credit, freeze fee, transfer fee
alter table public.memberships drop constraint if exists memberships_kind_check;
alter table public.memberships add constraint memberships_kind_check
  check (kind in ('membership','personal_training','pass','charge'));

-- Number existing counter sales and refunds
with n as (select id, row_number() over (partition by owner_id order by sold_on, created_at) rn from public.sales where receipt_no is null)
update public.sales s set receipt_no = 'S-' || lpad(n.rn::text, 5, '0') from n
 where n.id = s.id and not exists (select 1 from public.sales x where x.owner_id = s.owner_id and x.receipt_no is not null);
with n as (select id, row_number() over (partition by owner_id order by refunded_on, created_at) rn from public.refunds where refund_no is null)
update public.refunds r set refund_no = 'RF-' || lpad(n.rn::text, 5, '0') from n
 where n.id = r.id and not exists (select 1 from public.refunds x where x.owner_id = r.owner_id and x.refund_no is not null);

-- 2. New tables
-- ---------------------------------------------------------------------
-- PT session log (one row per session taken)
-- ---------------------------------------------------------------------
create table if not exists public.pt_sessions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users on delete cascade,
  membership_id uuid not null references public.memberships on delete cascade,
  member_id     uuid not null references public.members on delete cascade,
  trainer_id    uuid references public.trainers on delete set null,
  session_date  date not null,
  notes         text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Equipment service history
-- ---------------------------------------------------------------------
create table if not exists public.equipment_services (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users on delete cascade,
  equipment_id  uuid not null references public.equipment on delete cascade,
  serviced_on   date not null,
  cost          numeric(12,2) not null default 0 check (cost >= 0),
  next_service  date,
  notes         text,
  expense_id    uuid references public.expenses on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Recurring expenses (rent, salaries, internet ...) posted once a month
-- ---------------------------------------------------------------------
create table if not exists public.recurring_expenses (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users on delete cascade,
  category      text not null check (category in ('rent','salary','utilities','equipment','maintenance','marketing','supplies','other')),
  amount        numeric(12,2) not null check (amount > 0),
  vendor        text,
  description   text,
  method        text not null default 'bank' check (method in ('cash','card','upi','bank','online','other')),
  day_of_month  int not null default 1 check (day_of_month between 1 and 28),
  trainer_id    uuid references public.trainers on delete set null,
  is_active     boolean not null default true,
  last_posted   date,  -- first day of the last month it was added
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Class bookings (one row per member per class date)
-- ---------------------------------------------------------------------
create table if not exists public.class_bookings (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  class_id    uuid not null references public.classes on delete cascade,
  member_id   uuid not null references public.members on delete cascade,
  class_date  date not null,
  status      text not null default 'booked' check (status in ('booked','attended','cancelled','no_show')),
  created_at  timestamptz not null default now(),
  unique (class_id, member_id, class_date)
);

create index if not exists idx_pt_sessions_membership on public.pt_sessions (membership_id, session_date desc);
create index if not exists idx_pt_sessions_trainer  on public.pt_sessions (owner_id, trainer_id, session_date);
create index if not exists idx_equip_services       on public.equipment_services (equipment_id, serviced_on desc);
create index if not exists idx_class_bookings_date  on public.class_bookings (class_id, class_date);
create index if not exists idx_expenses_trainer     on public.expenses (trainer_id) where trainer_id is not null;
create unique index if not exists idx_payments_share on public.payments (share_token);
create unique index if not exists idx_sales_share    on public.sales (share_token);

do $$
declare t text;
begin
  foreach t in array array['pt_sessions','equipment_services','recurring_expenses','class_bookings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated
                    using (owner_id = (select auth.uid()))
                    with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;

-- 3. Functions with changed signatures are dropped first
drop function if exists public.trainer_pt_stats(date, date, date);
drop function if exists public.freeze_membership(uuid, date, int, text);

-- 4. Reports: consistent counts, credit sales count when paid
-- Dashboard headline numbers in one round trip
create or replace function public.dashboard_stats(
  p_today date, p_alert_days int, p_day_start timestamptz, p_day_end timestamptz
) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'total_members',   (select count(*) from member_overview
                         where status <> 'inactive' and coalesce(membership_kind, 'membership') <> 'pass'),
    'active_members',  (select count(*) from member_overview
                         where status = 'active' and membership_status = 'active' and membership_kind = 'membership'
                           and membership_end >= p_today),
    'expiring',        (select count(*) from member_overview
                         where status <> 'inactive' and membership_kind = 'membership'
                           and membership_end between p_today and p_today + p_alert_days),
    'renewals_due',    (select count(*) from member_overview
                         where status <> 'inactive' and membership_kind = 'membership'
                           and membership_end between p_today and p_today + p_alert_days)
                     + (select count(*) from member_overview
                         where status <> 'inactive' and pt_end between p_today and p_today + p_alert_days),
    'expired',         (select count(*) from member_overview
                         where status <> 'inactive' and membership_kind = 'membership' and membership_end < p_today),
    'frozen_now',      (select count(*) from member_overview where freeze_start <= p_today and freeze_end >= p_today),
    'passes_today',    (select count(*) from memberships where kind = 'pass' and p_today between start_date and end_date),
    'new_members',     (select count(*) from member_overview
                         where joined_on >= date_trunc('month', p_today)::date
                           and coalesce(membership_kind, 'membership') <> 'pass'),
    'checkins_today',  (select count(*) from attendance where check_in >= p_day_start and check_in < p_day_end),
    'inside_now',      (select count(*) from attendance  -- open visits from the last 4 hours
                         where check_in >= greatest(p_day_start, now() - interval '4 hours')
                           and check_in < p_day_end and check_out is null),
    'revenue_month',   (select coalesce(sum(amount), 0) from payments
                         where paid_on between date_trunc('month', p_today)::date and p_today)
                     + (select coalesce(sum(total), 0) from sales
                         where not on_credit and sold_on between date_trunc('month', p_today)::date and p_today)
                     - (select coalesce(sum(amount), 0) from refunds
                         where refunded_on between date_trunc('month', p_today)::date and p_today),
    'revenue_today',   (select coalesce(sum(amount), 0) from payments where paid_on = p_today)
                     + (select coalesce(sum(total), 0) from sales where not on_credit and sold_on = p_today)
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
              where not s.on_credit and s.sold_on >= greatest(m.month, p_from)
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
    select method, 'product', total from sales where not on_credit and sold_on between p_from and p_to
    union all
    select method, 'refund', -amount from refunds where refunded_on between p_from and p_to
  )
  select 'method', method, sum(amount), count(*) from money_in group by method
  union all
  select 'category', category, sum(amount), count(*) from money_in group by category;
$$;

-- Memberships sold per plan (by start date)
create or replace function public.plan_breakdown(p_from date, p_to date)
returns table (plan_name text, sold bigint, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select plan_name, count(*), sum(price - discount) from memberships
   where start_date between p_from and p_to and status <> 'cancelled' and kind <> 'charge'
   group by plan_name order by 3 desc;
$$;

-- Personal training per trainer: active PT clients and PT fees collected in range
create or replace function public.trainer_pt_stats(p_from date, p_to date, p_today date)
returns table (trainer_id uuid, clients bigint, revenue numeric, sessions bigint)
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
        and r.refunded_on between p_from and p_to),
    (select count(*) from pt_sessions s
      where s.trainer_id = t.id and s.session_date between p_from and p_to)
  from trainers t;
$$;

-- 5. Write functions
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
  if exists (select 1 from jsonb_array_elements(p_lines) l where l->>'kind' = 'membership') then
    update leads set status = 'converted'
     where converted_member_id = p_member_id and status in ('new','contacted','trial');
  end if;
  return record_payments(v_rows);
end $$;

-- Pause a membership for p_days from p_start; the end date moves out by p_days.
create or replace function public.freeze_membership(
  p_membership_id uuid, p_start date, p_days int, p_reason text, p_max_days int default null, p_fee numeric default 0
) returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_used int;
begin
  if p_days is null or p_days < 1 then
    raise exception 'A freeze must be at least 1 day';
  end if;
  select coalesce(sum(days), 0) into v_used from membership_freezes where membership_id = p_membership_id;
  if p_max_days is not null and v_used + p_days > p_max_days then
    raise exception 'Freeze limit is % days per plan; % already used', p_max_days, v_used;
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
  if coalesce(p_fee, 0) > 0 then
    insert into memberships (member_id, plan_name, kind, start_date, end_date, price, balance_due_on, notes)
    select member_id, 'Freeze fee', 'charge', p_start, p_start, p_fee, p_start, 'Freeze of ' || plan_name || ' for ' || p_days || ' days'
      from memberships where id = p_membership_id;
  end if;
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
    perform pg_advisory_xact_lock(hashtext('refund:' || coalesce(auth.uid()::text, '')));
    insert into refunds (member_id, membership_id, amount, method, refunded_on, reason, refund_no)
    values (b.member_id, b.id, p_amount, coalesce(p_method, 'cash'), coalesce(p_date, current_date), nullif(p_reason, ''),
            (select 'RF-' || lpad((coalesce(max(substring(refund_no from 4)::int), 0) + 1)::text, 5, '0')
               from refunds where refund_no ~ '^RF-[0-9]+$'));
    if not p_cancel then
      -- Money given back on a plan that continues: the fee is lowered by the same
      -- amount so the refund doesn't reappear as a balance due.
      update memberships
         set discount = discount + p_amount,
             notes = concat_ws(E'\n', nullif(notes, ''),
                               'Refund ' || p_amount || ' on ' || coalesce(p_date, current_date) || coalesce(': ' || nullif(p_reason, ''), ''))
       where id = p_membership_id;
    end if;
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

-- ---------------------------------------------------------------------
-- More write functions (one transaction each)
-- ---------------------------------------------------------------------

-- Log one PT session (date + trainer) and count it against the package.
create or replace function public.log_pt_session(p_membership_id uuid, p_date date, p_notes text)
returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  m memberships;
begin
  select * into m from memberships where id = p_membership_id for update;
  if not found or m.kind <> 'personal_training' then
    raise exception 'PT package not found';
  end if;
  if m.status <> 'active' then
    raise exception 'This PT package is not active';
  end if;
  if m.sessions_total is not null and m.sessions_used >= m.sessions_total then
    raise exception 'All sessions in this package are used';
  end if;
  insert into pt_sessions (membership_id, member_id, trainer_id, session_date, notes)
  values (m.id, m.member_id, m.trainer_id, coalesce(p_date, current_date), nullif(p_notes, ''));
  update memberships set sessions_used = sessions_used + 1 where id = m.id;
end $$;

-- Undo the most recent PT session.
create or replace function public.undo_pt_session(p_membership_id uuid)
returns void
language plpgsql volatile security invoker set search_path = public as $$
begin
  if (select sessions_used from memberships where id = p_membership_id) < 1 then
    raise exception 'No sessions to undo';
  end if;
  delete from pt_sessions where id = (
    select id from pt_sessions where membership_id = p_membership_id
     order by session_date desc, created_at desc limit 1);
  update memberships set sessions_used = sessions_used - 1 where id = p_membership_id;
end $$;

-- Counter sale with its own receipt number (S-00001). On credit, the amount
-- becomes a "charge" in the member's dues and counts as revenue when paid.
create or replace function public.pos_sale(
  p_product_id uuid, p_quantity int, p_unit_price numeric, p_member_id uuid, p_method text,
  p_sold_on date, p_on_credit boolean, p_due_on date
) returns text
language plpgsql volatile security invoker set search_path = public as $$
declare
  p products;
  v_no text;
  v_charge uuid;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1';
  end if;
  select * into p from products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found';
  end if;
  if p.stock < p_quantity then
    raise exception 'Only % of % in stock', p.stock, p.name;
  end if;
  if p_on_credit and p_member_id is null then
    raise exception 'Pick the member to add this sale to their dues';
  end if;
  perform pg_advisory_xact_lock(hashtext('sale:' || coalesce(auth.uid()::text, '')));
  select 'S-' || lpad((coalesce(max(substring(receipt_no from 3)::int), 0) + 1)::text, 5, '0')
    into v_no from sales where receipt_no ~ '^S-[0-9]+$';
  if p_on_credit then
    insert into memberships (member_id, plan_name, kind, start_date, end_date, price, balance_due_on, notes)
    values (p_member_id, p.name || ' x ' || p_quantity, 'charge', p_sold_on, p_sold_on,
            p_quantity * p_unit_price, coalesce(p_due_on, p_sold_on + 7), 'Counter sale ' || v_no)
    returning id into v_charge;
  end if;
  insert into sales (product_id, product_name, member_id, quantity, unit_price, unit_cost, method, sold_on,
                     receipt_no, on_credit, charge_id)
  values (p.id, p.name, p_member_id, p_quantity, p_unit_price, p.cost,
          case when p_on_credit then 'other' else coalesce(p_method, 'cash') end, p_sold_on, v_no, p_on_credit, v_charge);
  return v_no;
end $$;

-- Voiding a credit sale removes its unpaid charge (blocked if it was paid).
create or replace function public.remove_sale_charge()
returns trigger language plpgsql as $$
begin
  if old.charge_id is not null then
    delete from memberships where id = old.charge_id;
  end if;
  return old;
end $$;

drop trigger if exists trg_sales_charge on public.sales;
create trigger trg_sales_charge after delete on public.sales
  for each row execute function public.remove_sale_charge();

-- Deleting a payment reopens the balance: give it a due date if it has none.
create or replace function public.reopen_due_date()
returns trigger language plpgsql as $$
begin
  if old.membership_id is not null then
    update memberships set balance_due_on = coalesce(balance_due_on, current_date + 7)
     where id = old.membership_id and status <> 'cancelled';
  end if;
  return old;
end $$;

drop trigger if exists trg_payments_reopen on public.payments;
create trigger trg_payments_reopen after delete on public.payments
  for each row execute function public.reopen_due_date();

-- Move a membership / PT package to another member (optional transfer fee as a due).
create or replace function public.transfer_membership(
  p_membership_id uuid, p_to_member uuid, p_fee numeric, p_note text, p_date date
) returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  m memberships;
  v_from text;
begin
  select * into m from memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership not found';
  end if;
  if m.kind not in ('membership', 'personal_training') or m.status = 'cancelled' then
    raise exception 'Only active memberships and PT packages can be transferred';
  end if;
  if m.member_id = p_to_member then
    raise exception 'Choose a different member';
  end if;
  if not exists (select 1 from members where id = p_to_member) then
    raise exception 'Member not found';
  end if;
  select full_name || ' (' || member_code || ')' into v_from from members where id = m.member_id;
  update memberships
     set member_id = p_to_member,
         notes = concat_ws(E'\n', nullif(notes, ''),
                           'Transferred from ' || v_from || ' on ' || coalesce(p_date, current_date)
                           || coalesce(': ' || nullif(p_note, ''), ''))
   where id = m.id;
  update membership_freezes set member_id = p_to_member where membership_id = m.id;
  update pt_sessions set member_id = p_to_member where membership_id = m.id;
  if coalesce(p_fee, 0) > 0 then
    insert into memberships (member_id, plan_name, kind, start_date, end_date, price, balance_due_on, notes)
    values (p_to_member, 'Transfer fee', 'charge', coalesce(p_date, current_date), coalesce(p_date, current_date),
            p_fee, coalesce(p_date, current_date), 'Transfer of ' || m.plan_name || ' from ' || v_from);
  end if;
end $$;

-- Log an equipment service: history row, dates on the machine, optional expense.
create or replace function public.log_equipment_service(
  p_equipment_id uuid, p_date date, p_next date, p_cost numeric, p_notes text
) returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  e equipment;
  v_expense uuid;
begin
  select * into e from equipment where id = p_equipment_id for update;
  if not found then
    raise exception 'Equipment not found';
  end if;
  if coalesce(p_cost, 0) > 0 then
    insert into expenses (category, amount, spent_on, description)
    values ('maintenance', p_cost, p_date, 'Service: ' || e.name || coalesce(' (' || nullif(p_notes, '') || ')', ''))
    returning id into v_expense;
  end if;
  insert into equipment_services (equipment_id, serviced_on, cost, next_service, notes, expense_id)
  values (e.id, p_date, coalesce(p_cost, 0), p_next, nullif(p_notes, ''), v_expense);
  update equipment set last_service = p_date, next_service = p_next, status = 'working' where id = e.id;
end $$;

-- Add this month's recurring expenses that are due (day reached, not yet added).
create or replace function public.post_recurring_expenses(p_today date)
returns int
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_month date := date_trunc('month', p_today)::date;
  v_count int;
begin
  with due as (
    select * from recurring_expenses
     where is_active and day_of_month <= extract(day from p_today)
       and (last_posted is null or last_posted < v_month)
     for update
  ), added as (
    insert into expenses (category, amount, spent_on, vendor, description, method, trainer_id)
    select category, amount, v_month + (day_of_month - 1), vendor,
           coalesce(description, initcap(category)) || ' (' || to_char(v_month, 'Mon YYYY') || ')', method, trainer_id
      from due
    returning 1
  )
  select count(*) into v_count from added;
  update recurring_expenses set last_posted = v_month
   where is_active and day_of_month <= extract(day from p_today)
     and (last_posted is null or last_posted < v_month);
  return v_count;
end $$;

-- Book a member into a class on a date, respecting capacity.
create or replace function public.book_class(p_class_id uuid, p_member_id uuid, p_date date)
returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  c classes;
  v_taken int;
begin
  select * into c from classes where id = p_class_id for update;
  if not found or not c.is_active then
    raise exception 'Class not found';
  end if;
  if extract(dow from p_date)::int <> c.day_of_week then
    raise exception 'This class does not run on that day';
  end if;
  if exists (select 1 from class_bookings where class_id = c.id and member_id = p_member_id
                and class_date = p_date and status in ('booked','attended')) then
    raise exception 'Already booked';
  end if;
  select count(*) into v_taken from class_bookings
   where class_id = c.id and class_date = p_date and status in ('booked','attended');
  if v_taken >= c.capacity then
    raise exception 'Class is full (% spots)', c.capacity;
  end if;
  insert into class_bookings (class_id, member_id, class_date)
  values (c.id, p_member_id, p_date)
  on conflict (class_id, member_id, class_date) do update set status = 'booked';
end $$;

-- Public receipt by share link (no login). Returns only what the receipt shows.
create or replace function public.public_receipt(p_token uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_pay payments;
  v_sale sales;
  v_gym json;
begin
  select * into v_pay from payments where share_token = p_token;
  if found then
    select json_build_object('gym_name', gym_name, 'address', address, 'phone', phone, 'email', email,
                             'currency', currency, 'tax_rate', tax_rate)
      into v_gym from gym_settings where owner_id = v_pay.owner_id;
    return json_build_object(
      'type', 'payment',
      'receipt_no', v_pay.receipt_no,
      'date', v_pay.paid_on,
      'method', v_pay.method,
      'reference', v_pay.reference,
      'gym', v_gym,
      'member', (select json_build_object('full_name', full_name, 'member_code', member_code) from members where id = v_pay.member_id),
      'items', (select json_agg(json_build_object(
                  'label', coalesce(b.plan_name, initcap(replace(p.category, '_', ' '))),
                  'kind', b.kind, 'start_date', b.start_date, 'end_date', b.end_date,
                  'fee', b.price - b.discount, 'amount', p.amount) order by p.created_at)
                  from payments p left join memberships b on b.id = p.membership_id
                 where p.owner_id = v_pay.owner_id
                   and (p.id = v_pay.id or (v_pay.receipt_no is not null and p.receipt_no = v_pay.receipt_no))),
      'balance', (select coalesce(sum(greatest(b.price - b.discount - coalesce((select sum(x.amount) from payments x where x.membership_id = b.id), 0)
                                                 + coalesce((select sum(r.amount) from refunds r where r.membership_id = b.id), 0), 0)), 0)
                    from memberships b
                   where b.status <> 'cancelled' and b.id in (
                     select membership_id from payments p where p.owner_id = v_pay.owner_id
                        and (p.id = v_pay.id or (v_pay.receipt_no is not null and p.receipt_no = v_pay.receipt_no))))
    );
  end if;
  select * into v_sale from sales where share_token = p_token;
  if found then
    select json_build_object('gym_name', gym_name, 'address', address, 'phone', phone, 'email', email,
                             'currency', currency, 'tax_rate', tax_rate)
      into v_gym from gym_settings where owner_id = v_sale.owner_id;
    return json_build_object(
      'type', 'sale',
      'receipt_no', v_sale.receipt_no,
      'date', v_sale.sold_on,
      'method', case when v_sale.on_credit then 'added to dues' else v_sale.method end,
      'gym', v_gym,
      'member', (select json_build_object('full_name', full_name, 'member_code', member_code) from members where id = v_sale.member_id),
      'items', json_build_array(json_build_object('label', v_sale.product_name || ' x ' || v_sale.quantity,
                                                  'fee', v_sale.total, 'amount', case when v_sale.on_credit then 0 else v_sale.total end)),
      'balance', case when v_sale.on_credit then v_sale.total else 0 end
    );
  end if;
  return null;
end $$;

revoke all on function public.public_receipt(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.public_receipt(uuid) to anon, authenticated';
  end if;
end $$;

-- Private storage bucket for expense bill photos (Supabase only; skipped elsewhere).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('bills', 'bills', false) on conflict (id) do nothing;
    execute 'drop policy if exists "bills_owner" on storage.objects';
    execute $p$create policy "bills_owner" on storage.objects for all to authenticated
              using (bucket_id = 'bills' and (storage.foldername(name))[1] = (select auth.uid())::text)
              with check (bucket_id = 'bills' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;
