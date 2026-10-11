-- =====================================================================
-- Gym Manager: Supabase schema
-- Run this whole file once in Supabase Dashboard → SQL Editor.
-- Every table is owned by the signed-in owner (owner_id = auth.uid())
-- and protected by Row Level Security, so only the owner sees their data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: updated_at trigger
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Gym settings (one row per owner)
-- ---------------------------------------------------------------------
create table if not exists public.gym_settings (
  owner_id      uuid primary key default auth.uid() references auth.users on delete cascade,
  gym_name      text not null default 'My Gym',
  phone         text,
  email         text,
  address       text,
  currency      text not null default 'INR',
  timezone      text not null default 'Asia/Kolkata',
  tax_rate      numeric(5,2) not null default 0,
  expiry_alert_days int not null default 7,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Membership plans
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name          text not null,
  duration_days int  not null check (duration_days > 0),
  price         numeric(12,2) not null check (price >= 0),
  admission_fee numeric(12,2) not null default 0 check (admission_fee >= 0),
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Trainers / staff
-- ---------------------------------------------------------------------
create table if not exists public.trainers (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users on delete cascade,
  full_name      text not null,
  phone          text,
  email          text,
  role           text not null default 'Trainer',
  specialization text,
  salary         numeric(12,2) not null default 0,
  joined_on      date not null default current_date,
  status         text not null default 'active' check (status in ('active','inactive')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------
create table if not exists public.members (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users on delete cascade,
  member_code       text not null,
  full_name         text not null,
  phone             text,
  email             text,
  gender            text check (gender in ('male','female','other')),
  date_of_birth     date,
  address           text,
  emergency_name    text,
  emergency_phone   text,
  medical_notes     text,
  trainer_id        uuid references public.trainers on delete set null,
  joined_on         date not null default current_date,
  status            text not null default 'active' check (status in ('active','frozen','inactive')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (owner_id, member_code)
);

-- Auto-generate member codes like M-0001 per owner
create or replace function public.assign_member_code()
returns trigger language plpgsql as $$
declare next_no int;
begin
  if new.member_code is null or new.member_code = '' then
    select coalesce(max(nullif(regexp_replace(member_code, '\D', '', 'g'), '')::int), 0) + 1
      into next_no
      from public.members where owner_id = new.owner_id;
    new.member_code := 'M-' || lpad(next_no::text, 4, '0');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Memberships (gym memberships and personal-training packages a member buys)
-- ---------------------------------------------------------------------
create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  member_id   uuid not null references public.members on delete cascade,
  plan_id     uuid references public.plans on delete set null,
  plan_name   text not null,
  start_date  date not null,
  end_date    date not null,
  price       numeric(12,2) not null default 0,
  discount    numeric(12,2) not null default 0,
  status      text not null default 'active' check (status in ('active','cancelled','frozen')),
  notes       text,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- Payments (fee collections). Every payment belongs to a member, and fee
-- payments are applied to one of their memberships. Members/memberships with
-- payments can't be deleted, so the money trail is never lost.
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users on delete cascade,
  member_id     uuid references public.members on delete set null,
  membership_id uuid references public.memberships on delete set null,
  amount        numeric(12,2) not null check (amount > 0),
  method        text not null default 'cash' check (method in ('cash','card','upi','bank','online','other')),
  category      text not null default 'membership' check (category in ('membership','admission','personal_training','product','other')),
  paid_on       date not null default current_date,
  reference     text,
  notes         text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Attendance (check-ins)
-- ---------------------------------------------------------------------
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  member_id   uuid not null references public.members on delete cascade,
  check_in    timestamptz not null default now(),
  check_out   timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Body measurements / progress
-- ---------------------------------------------------------------------
create table if not exists public.measurements (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users on delete cascade,
  member_id    uuid not null references public.members on delete cascade,
  measured_on  date not null default current_date,
  weight_kg    numeric(6,2),
  height_cm    numeric(6,2),
  body_fat_pct numeric(5,2),
  chest_cm     numeric(6,2),
  waist_cm     numeric(6,2),
  arms_cm      numeric(6,2),
  notes        text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Group classes (weekly timetable)
-- ---------------------------------------------------------------------
create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  trainer_id  uuid references public.trainers on delete set null,
  day_of_week int  not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_time  time not null,
  end_time    time not null,
  capacity    int  not null default 20 check (capacity > 0),
  room        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  check (end_time > start_time)
);

-- ---------------------------------------------------------------------
-- Expenses (money out)
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  category    text not null check (category in ('rent','salary','utilities','equipment','maintenance','marketing','supplies','other')),
  amount      numeric(12,2) not null check (amount > 0),
  spent_on    date not null default current_date,
  vendor      text,
  description text,
  method      text not null default 'cash' check (method in ('cash','card','upi','bank','online','other')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Inventory & point-of-sale
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users on delete cascade,
  name            text not null,
  sku             text,
  category        text not null default 'supplement',
  price           numeric(12,2) not null default 0 check (price >= 0),
  cost            numeric(12,2) not null default 0 check (cost >= 0),
  stock           int not null default 0,
  low_stock_level int not null default 5,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.sales (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  product_id  uuid references public.products on delete set null,
  product_name text not null,
  member_id   uuid references public.members on delete set null,
  quantity    int not null check (quantity > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  unit_cost   numeric(12,2) not null default 0,
  total       numeric(12,2) generated always as (quantity * unit_price) stored,
  method      text not null default 'cash' check (method in ('cash','card','upi','bank','online','other')),
  sold_on     date not null default current_date,
  created_at  timestamptz not null default now()
);

-- Keep stock in sync with sales
create or replace function public.apply_sale_stock()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.product_id is not null then
    update public.products set stock = stock - new.quantity where id = new.product_id;
  elsif tg_op = 'DELETE' and old.product_id is not null then
    update public.products set stock = stock + old.quantity where id = old.product_id;
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Equipment & maintenance
-- ---------------------------------------------------------------------
create table if not exists public.equipment (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users on delete cascade,
  name           text not null,
  category       text not null default 'cardio',
  brand          text,
  serial_no      text,
  quantity       int not null default 1 check (quantity > 0),
  purchase_date  date,
  purchase_cost  numeric(12,2) not null default 0,
  status         text not null default 'working' check (status in ('working','needs_service','out_of_order','retired')),
  last_service   date,
  next_service   date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Leads / enquiries
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users on delete cascade,
  full_name       text not null,
  phone           text,
  email           text,
  source          text not null default 'walk_in' check (source in ('walk_in','referral','instagram','facebook','google','website','other')),
  interest        text,
  status          text not null default 'new' check (status in ('new','contacted','trial','converted','lost')),
  follow_up_on    date,
  notes           text,
  converted_member_id uuid references public.members on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
create index if not exists idx_members_owner        on public.members (owner_id, status);
create index if not exists idx_memberships_member   on public.memberships (member_id, end_date desc);
create index if not exists idx_memberships_owner_end on public.memberships (owner_id, end_date);
create index if not exists idx_payments_owner_date  on public.payments (owner_id, paid_on desc);
create index if not exists idx_payments_member      on public.payments (member_id);
create index if not exists idx_attendance_owner_in  on public.attendance (owner_id, check_in desc);
create index if not exists idx_attendance_member    on public.attendance (member_id, check_in desc);
create index if not exists idx_expenses_owner_date  on public.expenses (owner_id, spent_on desc);
create index if not exists idx_sales_owner_date     on public.sales (owner_id, sold_on desc);
create index if not exists idx_leads_owner_status   on public.leads (owner_id, status);
create index if not exists idx_measurements_member  on public.measurements (member_id, measured_on desc);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
drop trigger if exists trg_members_code on public.members;
create trigger trg_members_code before insert on public.members
  for each row execute function public.assign_member_code();

drop trigger if exists trg_sales_stock on public.sales;
create trigger trg_sales_stock after insert or delete on public.sales
  for each row execute function public.apply_sale_stock();

do $$
declare t text;
begin
  foreach t in array array['gym_settings','plans','trainers','members','products','equipment','leads'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Views (security_invoker so RLS of the caller applies)
-- ---------------------------------------------------------------------

-- Each membership with what has been paid against it and the balance due
create or replace view public.membership_balances
with (security_invoker = true) as
select
  ms.*,
  coalesce(p.paid, 0)                              as paid,
  greatest(ms.price - ms.discount - coalesce(p.paid, 0), 0) as balance
from public.memberships ms
left join (
  select membership_id, sum(amount) as paid
  from public.payments
  where membership_id is not null
  group by membership_id
) p on p.membership_id = ms.id;

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
  coalesce(dues.balance, 0) as balance_due,
  la.last_visit
from public.members m
left join public.trainers t on t.id = m.trainer_id
left join lateral (
  select * from public.memberships x
  where x.member_id = m.id and x.status <> 'cancelled'
  order by x.end_date desc
  limit 1
) lm on true
left join lateral (
  select sum(b.balance) as balance from public.membership_balances b
  where b.member_id = m.id and b.status <> 'cancelled'
) dues on true
left join lateral (
  select max(a.check_in) as last_visit from public.attendance a where a.member_id = m.id
) la on true;

-- ---------------------------------------------------------------------
-- Row Level Security: owner-only access on every table
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['gym_settings','plans','trainers','members','memberships','payments',
                           'attendance','measurements','classes','expenses','products','sales',
                           'equipment','leads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated
                    using (owner_id = (select auth.uid()))
                    with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Reporting functions (security invoker → RLS still applies)
-- ---------------------------------------------------------------------

-- Dashboard headline numbers in one round trip
create or replace function public.dashboard_stats(
  p_today date, p_alert_days int, p_day_start timestamptz, p_day_end timestamptz
) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'total_members',   (select count(*) from members where status <> 'inactive'),
    'active_members',  (select count(*) from member_overview
                         where status = 'active' and membership_status = 'active' and membership_end >= p_today),
    'expiring',        (select count(*) from member_overview
                         where status = 'active' and membership_end between p_today and p_today + p_alert_days),
    'expired',         (select count(*) from member_overview
                         where status <> 'inactive' and membership_end < p_today),
    'new_members',     (select count(*) from members where joined_on >= date_trunc('month', p_today)::date),
    'checkins_today',  (select count(*) from attendance where check_in >= p_day_start and check_in < p_day_end),
    'inside_now',      (select count(*) from attendance
                         where check_in >= p_day_start and check_in < p_day_end and check_out is null),
    'revenue_month',   (select coalesce(sum(amount), 0) from payments
                         where paid_on between date_trunc('month', p_today)::date and p_today)
                     + (select coalesce(sum(total), 0) from sales
                         where sold_on between date_trunc('month', p_today)::date and p_today),
    'revenue_today',   (select coalesce(sum(amount), 0) from payments where paid_on = p_today)
                     + (select coalesce(sum(total), 0) from sales where sold_on = p_today),
    'expenses_month',  (select coalesce(sum(amount), 0) from expenses
                         where spent_on between date_trunc('month', p_today)::date and p_today),
    'dues_total',      (select coalesce(sum(balance), 0) from membership_balances where status <> 'cancelled'),
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
                and p.paid_on <= least((m.month + interval '1 month - 1 day')::date, p_to)), 0),
    coalesce((select sum(s.total) from sales s
              where s.sold_on >= greatest(m.month, p_from)
                and s.sold_on <= least((m.month + interval '1 month - 1 day')::date, p_to)), 0),
    coalesce((select sum(e.amount) from expenses e
              where e.spent_on >= greatest(m.month, p_from)
                and e.spent_on <= least((m.month + interval '1 month - 1 day')::date, p_to)), 0)
  from months m
  order by m.month;
$$;

-- New member sign-ups per month
create or replace function public.members_monthly(p_from date, p_to date)
returns table (month date, joined bigint)
language sql stable security invoker set search_path = public as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month
  )
  select m.month, (select count(*) from members x
                   where x.joined_on >= greatest(m.month, p_from)
                     and x.joined_on <= least((m.month + interval '1 month - 1 day')::date, p_to))
  from months m order by m.month;
$$;

-- Money in grouped by method and by category (POS sales count as category "product")
create or replace function public.payment_breakdown(p_from date, p_to date)
returns table (dimension text, key text, total numeric, entries bigint)
language sql stable security invoker set search_path = public as $$
  with money_in as (
    select method, category, amount from payments where paid_on between p_from and p_to
    union all
    select method, 'product', total from sales where sold_on between p_from and p_to
  )
  select 'method', method, sum(amount), count(*) from money_in group by method
  union all
  select 'category', category, sum(amount), count(*) from money_in group by category;
$$;

create or replace function public.expense_breakdown(p_from date, p_to date)
returns table (category text, total numeric, entries bigint)
language sql stable security invoker set search_path = public as $$
  select category, sum(amount), count(*) from expenses
   where spent_on between p_from and p_to
   group by category order by 2 desc;
$$;

-- Memberships sold per plan (by start date)
create or replace function public.plan_breakdown(p_from date, p_to date)
returns table (plan_name text, sold bigint, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select plan_name, count(*), sum(price - discount) from memberships
   where start_date between p_from and p_to and status <> 'cancelled'
   group by plan_name order by 3 desc;
$$;

-- POS product performance
create or replace function public.sales_breakdown(p_from date, p_to date)
returns table (product_name text, quantity bigint, revenue numeric, profit numeric)
language sql stable security invoker set search_path = public as $$
  select product_name, sum(quantity), sum(total), sum(total - quantity * unit_cost) from sales
   where sold_on between p_from and p_to
   group by product_name order by 3 desc;
$$;

-- Members whose birthday is on the given date
create or replace function public.birthdays_on(p_day date)
returns setof public.members
language sql stable security invoker set search_path = public as $$
  select * from members
   where status <> 'inactive' and to_char(date_of_birth, 'MM-DD') = to_char(p_day, 'MM-DD')
   order by full_name;
$$;

-- Check-ins by local hour of day / weekday / calendar day
create or replace function public.attendance_by_hour(p_from timestamptz, p_to timestamptz, p_tz text)
returns table (hour int, visits bigint)
language sql stable security invoker set search_path = public as $$
  select extract(hour from check_in at time zone p_tz)::int, count(*) from attendance
   where check_in >= p_from and check_in < p_to group by 1 order by 1;
$$;

create or replace function public.attendance_by_weekday(p_from timestamptz, p_to timestamptz, p_tz text)
returns table (dow int, visits bigint)
language sql stable security invoker set search_path = public as $$
  select extract(dow from check_in at time zone p_tz)::int, count(*) from attendance
   where check_in >= p_from and check_in < p_to group by 1 order by 1;
$$;

create or replace function public.attendance_by_day(p_from timestamptz, p_to timestamptz, p_tz text)
returns table (day date, visits bigint, unique_members bigint)
language sql stable security invoker set search_path = public as $$
  select (check_in at time zone p_tz)::date, count(*), count(distinct member_id) from attendance
   where check_in >= p_from and check_in < p_to group by 1 order by 1;
$$;
