-- =====================================================================
-- SetFit Fitness: gym management (Supabase schema)
-- Run this whole file once in Supabase Dashboard → SQL Editor.
-- Every table belongs to the gym owner (owner_id); see "Who can use the gym's data"
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
  gym_name      text not null default 'SetFit Fitness',
  phone         text,
  email         text,
  address       text,
  currency      text not null default 'INR',
  timezone      text not null default 'Asia/Kolkata',
  tax_rate      numeric(5,2) not null default 0,
  expiry_alert_days int not null default 7,
  freeze_max_days int check (freeze_max_days > 0),          -- max freeze days per plan (null = no limit)
  freeze_fee    numeric(12,2) not null default 0 check (freeze_fee >= 0),
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
  kind          text not null default 'membership' check (kind in ('membership','personal_training','pass')),  -- pass = day pass / trial
  sessions      int check (sessions > 0),  -- PT packages: sessions included (null = unlimited)
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
  pt_commission_pct numeric(5,2) not null default 50 check (pt_commission_pct between 0 and 100),
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
  phone_digits      text generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored,
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
  photo_path        text,                                          -- photo in the member-photos bucket
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
  kind        text not null default 'membership' check (kind in ('membership','personal_training','pass','charge')),  -- charge = one-off due (counter sale on credit, freeze/transfer fee)
  trainer_id  uuid references public.trainers on delete set null,  -- PT packages
  sessions_total int check (sessions_total > 0),
  sessions_used  int not null default 0 check (sessions_used >= 0),
  start_date  date not null,
  end_date    date not null,
  price       numeric(12,2) not null default 0,
  discount    numeric(12,2) not null default 0,
  balance_due_on date,  -- when the remaining balance (partial payment) is due
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
  member_id     uuid not null references public.members on delete restrict,
  membership_id uuid references public.memberships on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  method        text not null default 'cash' check (method in ('cash','card','upi','bank','online','other')),
  category      text not null default 'membership' check (category in ('membership','admission','personal_training','product','other')),
  paid_on       date not null default current_date,
  receipt_no    text,  -- R-00001; payments saved together on one bill share a number
  share_token   uuid not null default gen_random_uuid(),  -- public receipt link
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
  trainer_id  uuid references public.trainers on delete set null,  -- salary payouts
  bill_path   text,                                              -- photo of the bill in storage
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
  receipt_no  text,                                   -- S-00001
  on_credit   boolean not null default false,          -- added to the member's dues instead of paid now
  charge_id   uuid references public.memberships on delete set null,
  share_token uuid not null default gen_random_uuid(),
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
  refund_no     text,  -- RF-00001
  created_at    timestamptz not null default now()
);

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

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
create index if not exists idx_members_owner        on public.members (owner_id, status);
create index if not exists idx_memberships_member   on public.memberships (member_id, end_date desc);
create index if not exists idx_memberships_owner_end on public.memberships (owner_id, end_date);
create index if not exists idx_memberships_trainer  on public.memberships (trainer_id) where trainer_id is not null;
create index if not exists idx_payments_owner_date  on public.payments (owner_id, paid_on desc);
create index if not exists idx_payments_member      on public.payments (member_id);
create index if not exists idx_payments_membership  on public.payments (membership_id);
create index if not exists idx_memberships_owner_status_kind on public.memberships (owner_id, status, kind, end_date);
create index if not exists idx_payments_receipt     on public.payments (owner_id, receipt_no);
create index if not exists idx_attendance_owner_in  on public.attendance (owner_id, check_in desc);
create index if not exists idx_attendance_member    on public.attendance (member_id, check_in desc);
create index if not exists idx_expenses_owner_date  on public.expenses (owner_id, spent_on desc);
create index if not exists idx_sales_owner_date     on public.sales (owner_id, sold_on desc);
create index if not exists idx_leads_owner_status   on public.leads (owner_id, status);
create index if not exists idx_measurements_member  on public.measurements (member_id, measured_on desc);
create index if not exists idx_members_phone_digits on public.members (owner_id, phone_digits);
create index if not exists idx_freezes_membership   on public.membership_freezes (membership_id, start_date desc);
create index if not exists idx_refunds_owner_date   on public.refunds (owner_id, refunded_on desc);
create index if not exists idx_refunds_membership   on public.refunds (membership_id);
create index if not exists idx_pt_sessions_membership on public.pt_sessions (membership_id, session_date desc);
create index if not exists idx_pt_sessions_trainer  on public.pt_sessions (owner_id, trainer_id, session_date);
create index if not exists idx_equip_services       on public.equipment_services (equipment_id, serviced_on desc);
create index if not exists idx_class_bookings_date  on public.class_bookings (class_id, class_date);
create index if not exists idx_expenses_trainer     on public.expenses (trainer_id) where trainer_id is not null;
create unique index if not exists idx_payments_share on public.payments (share_token);
create unique index if not exists idx_sales_share    on public.sales (share_token);

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

-- Each membership with what has been paid against it (net of refunds) and the balance due
create or replace view public.membership_balances
with (security_invoker = true) as
select
  ms.*,
  coalesce(p.paid, 0) - coalesce(r.refunded, 0)                              as paid,
  coalesce(r.refunded, 0)                                                     as refunded,
  greatest(ms.price - ms.discount - (coalesce(p.paid, 0) - coalesce(r.refunded, 0)), 0) as balance
from public.memberships ms
left join lateral (
  select sum(amount) as paid
  from public.payments
  where membership_id = ms.id
) p on true
left join lateral (
  select sum(amount) as refunded
  from public.refunds
  where membership_id = ms.id
) r on true;

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

-- ---------------------------------------------------------------------
-- Who can use the gym's data
--   * The owner is the account that owns the gym_settings row. Their email
--     can change (Settings > Login email) without touching anything else.
--   * Staff logins are created by the owner in Settings > Staff. They can
--     view members, check in / out and collect fees, nothing more.
--   * Any other account sees nothing.
-- ---------------------------------------------------------------------
create table if not exists public.staff_accounts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users on delete cascade,
  user_id     uuid unique references auth.users on delete set null,   -- linked on their first sign-in
  email       text not null,
  full_name   text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists staff_accounts_email_key on public.staff_accounts (lower(email));

-- Every change to money and member records, with who made it. Rows are
-- written by triggers only and can't be edited or removed from the app.
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  actor_role  text not null,                     -- owner | staff | system (SQL editor, seed)
  table_name  text not null,
  record_id   uuid,
  action      text not null check (action in ('insert','update','delete','void')),
  reason      text,
  before      jsonb,                             -- the whole row before an update / delete
  after       jsonb                              -- the new row, or only the changed fields for an update
);
create index if not exists activity_log_owner_at on public.activity_log (owner_id, at desc);
create index if not exists activity_log_voided_token on public.activity_log ((before->>'share_token')) where action = 'void';

-- The gym the signed-in account works in: its own id for the owner, the
-- owner's id for active staff, null for everyone else.
create or replace function public.gym_id()
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return null;
  end if;
  if exists (select 1 from gym_settings where owner_id = v_uid) then
    return v_uid;
  end if;
  return (select owner_id from staff_accounts where user_id = v_uid and active);
end $$;

create or replace function public.is_owner()
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from gym_settings where owner_id = auth.uid());
end $$;

-- Role of the signed-in account for the app: owner | staff | inactive | unclaimed, or null.
-- A staff login is linked to its staff record by email on the first sign-in.
create or replace function public.my_access()
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  s       staff_accounts;
begin
  if v_uid is null then
    return null;
  end if;
  if exists (select 1 from gym_settings where owner_id = v_uid) then
    return json_build_object('role', 'owner', 'gym_id', v_uid);
  end if;
  select * into s from staff_accounts where user_id = v_uid;
  if not found then
    select email into v_email from auth.users where id = v_uid;
    update staff_accounts set user_id = v_uid
     where lower(email) = lower(v_email) and user_id is null
     returning * into s;
  end if;
  if s.id is not null then
    return json_build_object('role', case when s.active then 'staff' else 'inactive' end,
                             'gym_id', case when s.active then s.owner_id end,
                             'name', s.full_name);
  end if;
  if not exists (select 1 from gym_settings) then
    return json_build_object('role', 'unclaimed');
  end if;
  return null;
end $$;

-- Brand-new install: the first account to sign in becomes the owner.
create or replace function public.claim_gym()
returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_gym'));
  if auth.uid() is null or exists (select 1 from gym_settings)
     or exists (select 1 from staff_accounts where user_id = auth.uid()) then
    return false;
  end if;
  insert into gym_settings (owner_id) values (auth.uid());
  return true;
end $$;

-- Optional Supabase Auth hook (Authentication > Hooks > Before User Created):
-- only lets through sign-ups for staff emails the owner has added.
create or replace function public.hook_only_invited(event jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from staff_accounts
              where lower(email) = lower(event->'user'->>'email') and active and user_id is null) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Sign-ups are closed. Ask the gym owner to add you as staff.'));
end $$;
revoke execute on function public.hook_only_invited(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.hook_only_invited(jsonb) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.hook_only_invited(jsonb) to supabase_auth_admin';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['gym_settings','plans','trainers','members','memberships','payments',
                           'attendance','measurements','classes','expenses','products','sales',
                           'equipment','leads','membership_freezes','refunds',
                           'pt_sessions','equipment_services','recurring_expenses','class_bookings',
                           'staff_accounts'] loop
    execute format('alter table public.%I enable row level security', t);
    if t <> 'gym_settings' then
      -- rows added by staff belong to the owner's gym
      execute format('alter table public.%I alter column owner_id set default public.gym_id()', t);
    end if;
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated
                    using (owner_id = (select public.gym_id()) and (select public.is_owner()))
                    with check (owner_id = (select public.gym_id()) and (select public.is_owner()))', t);
  end loop;

  -- Staff: read what the member list, check-in and fee collection need
  foreach t in array array['gym_settings','plans','members','memberships','payments','refunds',
                           'membership_freezes','attendance'] loop
    execute format('drop policy if exists "staff_read" on public.%I', t);
    execute format('create policy "staff_read" on public.%I for select to authenticated
                    using (owner_id = (select public.gym_id()))', t);
  end loop;
  -- ...check members in, collect fees...
  foreach t in array array['attendance','payments'] loop
    execute format('drop policy if exists "staff_insert" on public.%I', t);
    execute format('create policy "staff_insert" on public.%I for insert to authenticated
                    with check (owner_id = (select public.gym_id()))', t);
  end loop;
  -- ...check out, and set the next due date (staff_limits keeps it to those fields)
  foreach t in array array['attendance','memberships'] loop
    execute format('drop policy if exists "staff_update" on public.%I', t);
    execute format('create policy "staff_update" on public.%I for update to authenticated
                    using (owner_id = (select public.gym_id()))
                    with check (owner_id = (select public.gym_id()))', t);
  end loop;
end $$;

alter table public.activity_log enable row level security;
drop policy if exists "owner_read" on public.activity_log;
create policy "owner_read" on public.activity_log for select to authenticated
  using (owner_id = (select public.gym_id()) and (select public.is_owner()));

-- Staff may only change the due date of a fee and the check-out time of a visit.
create or replace function public.staff_limits()
returns trigger language plpgsql set search_path = public as $$
declare
  v_allowed text[] := case tg_table_name when 'memberships' then array['balance_due_on', 'updated_at']
                                         else array['check_out'] end;
begin
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'Only the owner can make this change' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_memberships_staff on public.memberships;
create trigger trg_memberships_staff before update on public.memberships
  for each row execute function public.staff_limits();
drop trigger if exists trg_attendance_staff on public.attendance;
create trigger trg_attendance_staff before update on public.attendance
  for each row execute function public.staff_limits();

-- ---------------------------------------------------------------------
-- Activity log and void
-- ---------------------------------------------------------------------
create or replace function public.log_activity()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_reason  text  := nullif(current_setting('app.void_reason', true), '');
  v_changed jsonb := '{}'::jsonb;
  k         text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k <> 'updated_at' and v_new->k is distinct from v_old->k then
        v_changed := v_changed || jsonb_build_object(k, v_new->k);
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;
    end if;
    v_new := v_changed;
  end if;
  insert into activity_log (owner_id, actor_id, actor_email, actor_role, table_name, record_id, action, reason, before, after)
  values ((v_row->>'owner_id')::uuid,
          auth.uid(),
          (select email from auth.users where id = auth.uid()),
          case when auth.uid() is null then 'system' when public.is_owner() then 'owner' else 'staff' end,
          tg_table_name,
          (v_row->>'id')::uuid,
          case tg_op when 'INSERT' then 'insert' when 'UPDATE' then 'update'
                     else case when v_reason is null then 'delete' else 'void' end end,
          case when tg_op = 'DELETE' then v_reason end,
          v_old,
          v_new);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['payments','refunds','sales','memberships','members','expenses','staff_accounts'] loop
    execute format('drop trigger if exists trg_log on public.%I', t);
    execute format('create trigger trg_log after insert or update or delete on public.%I
                    for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- Money records can't simply be deleted: void_record() gives the reason.
-- (Deletes with no signed-in user, e.g. from the SQL Editor, are allowed.)
create or replace function public.require_void_reason()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and nullif(current_setting('app.void_reason', true), '') is null then
    raise exception 'Payments, refunds and sales can''t be deleted. Void them with a reason instead.'
      using errcode = '42501';
  end if;
  return old;
end $$;

do $$
declare t text;
begin
  foreach t in array array['payments','refunds','sales'] loop
    execute format('drop trigger if exists trg_void_only on public.%I', t);
    execute format('create trigger trg_void_only before delete on public.%I
                    for each row execute function public.require_void_reason()', t);
  end loop;
end $$;

-- Void a payment, refund or sale (owner only). It leaves the books, and the
-- activity log keeps the full record, who voided it and why.
create or replace function public.void_record(p_table text, p_id uuid, p_reason text)
returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  n int;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can void records' using errcode = '42501';
  end if;
  if p_table not in ('payments', 'refunds', 'sales') then
    raise exception 'This record can''t be voided';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for voiding';
  end if;
  perform set_config('app.void_reason', trim(p_reason), true);
  execute format('delete from public.%I where id = $1', p_table) using p_id;
  get diagnostics n = row_count;
  perform set_config('app.void_reason', '', true);
  if n = 0 then
    raise exception 'Record not found';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Reporting functions (security invoker → RLS still applies)
-- ---------------------------------------------------------------------

-- Dashboard headline numbers in one round trip
create or replace function public.dashboard_stats(
  p_today date, p_alert_days int, p_day_start timestamptz, p_day_end timestamptz
) returns json
language sql stable security invoker set search_path = public as $$
  with mo as (
    select
      status,
      joined_on,
      membership_kind,
      membership_status,
      membership_end,
      pt_end,
      freeze_start,
      freeze_end
    from member_overview
  ),
  mc as (
    select
      coalesce(count(*) filter (where status <> 'inactive' and coalesce(membership_kind, 'membership') <> 'pass'), 0) as total_members,
      coalesce(count(*) filter (where status = 'active' and membership_status = 'active' and membership_kind = 'membership' and membership_end >= p_today), 0) as active_members,
      coalesce(count(*) filter (where status <> 'inactive' and membership_kind = 'membership' and membership_end between p_today and p_today + p_alert_days), 0) as expiring,
      coalesce(count(*) filter (where status <> 'inactive' and membership_kind = 'membership' and membership_end between p_today and p_today + p_alert_days), 0)
      + coalesce(count(*) filter (where status <> 'inactive' and pt_end between p_today and p_today + p_alert_days), 0) as renewals_due,
      coalesce(count(*) filter (where status <> 'inactive' and membership_kind = 'membership' and membership_end < p_today), 0) as expired,
      coalesce(count(*) filter (where freeze_start <= p_today and freeze_end >= p_today), 0) as frozen_now,
      coalesce(count(*) filter (where joined_on >= date_trunc('month', p_today)::date and coalesce(membership_kind, 'membership') <> 'pass'), 0) as new_members
    from mo
  ),
  mb as (
    select
      coalesce(sum(balance), 0) as dues_total,
      coalesce(count(distinct member_id) filter (where balance > 0), 0) as dues_members,
      coalesce(count(*) filter (where balance > 0 and balance_due_on < p_today), 0) as dues_overdue
    from membership_balances
    where status <> 'cancelled'
  )
  select json_build_object(
    'total_members',   (select total_members from mc),
    'active_members',  (select active_members from mc),
    'expiring',        (select expiring from mc),
    'renewals_due',    (select renewals_due from mc),
    'expired',         (select expired from mc),
    'frozen_now',      (select frozen_now from mc),
    'passes_today',    (select count(*) from memberships where kind = 'pass' and p_today between start_date and end_date),
    'new_members',     (select new_members from mc),
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
    'dues_total',      (select dues_total from mb),
    'dues_members',    (select dues_members from mb),
    'dues_overdue',    (select dues_overdue from mb),
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
    select method, 'product', total from sales where not on_credit and sold_on between p_from and p_to
    union all
    select method, 'refund', -amount from refunds where refunded_on between p_from and p_to
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
   where start_date between p_from and p_to and status <> 'cancelled' and kind <> 'charge'
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

-- Next sequential receipt number for the signed-in owner (R-00001, R-00002, ...)
create or replace function public.next_receipt_no()
returns text
language sql volatile security invoker set search_path = public as $$
  select 'R-' || lpad((coalesce(max(substring(receipt_no from 3)::int), 0) + 1)::text, 5, '0')
    from payments where receipt_no ~ '^R-[0-9]+$';
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
  perform pg_advisory_xact_lock(hashtext('receipt:' || coalesce(public.gym_id()::text, '')));
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
  if exists (select 1 from jsonb_array_elements(p_lines) l where l->>'kind' = 'membership') then
    update leads set status = 'converted'
     where converted_member_id = p_member_id and status in ('new','contacted','trial');
  end if;
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

-- Clear the old manual "frozen" flags (member status / plan status) for a member.
create or replace function public.clear_frozen_status(p_member_id uuid)
returns void
language plpgsql volatile security invoker set search_path = public as $$
begin
  update members set status = 'active' where id = p_member_id and status = 'frozen';
  update memberships set status = 'active' where member_id = p_member_id and status = 'frozen';
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
  -- Also clear any old manual "frozen" flags so the member is fully active again
  perform clear_frozen_status(f.member_id);
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
  if exists (select 1 from activity_log where action = 'void' and before->>'share_token' = p_token::text) then
    return (select json_build_object('type', 'void', 'receipt_no', before->>'receipt_no')
              from activity_log where action = 'void' and before->>'share_token' = p_token::text
             order by at desc limit 1);
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

-- Private storage buckets (Supabase only; skipped elsewhere). Files sit in a
-- folder named after the gym owner's id.
--   bills:         expense bill photos, owner only
--   member-photos: member photos, owner uploads, staff can view at check-in
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('bills', 'bills', false) on conflict (id) do nothing;
    insert into storage.buckets (id, name, public) values ('member-photos', 'member-photos', false) on conflict (id) do nothing;
    execute 'drop policy if exists "bills_owner" on storage.objects';
    execute $p$create policy "bills_owner" on storage.objects for all to authenticated
              using (bucket_id = 'bills' and (storage.foldername(name))[1] = (select public.gym_id())::text
                     and (select public.is_owner()))
              with check (bucket_id = 'bills' and (storage.foldername(name))[1] = (select public.gym_id())::text
                          and (select public.is_owner()))$p$;
    execute 'drop policy if exists "member_photos_owner" on storage.objects';
    execute $p$create policy "member_photos_owner" on storage.objects for all to authenticated
              using (bucket_id = 'member-photos' and (storage.foldername(name))[1] = (select public.gym_id())::text
                     and (select public.is_owner()))
              with check (bucket_id = 'member-photos' and (storage.foldername(name))[1] = (select public.gym_id())::text
                          and (select public.is_owner()))$p$;
    execute 'drop policy if exists "member_photos_staff_read" on storage.objects';
    execute $p$create policy "member_photos_staff_read" on storage.objects for select to authenticated
              using (bucket_id = 'member-photos' and (storage.foldername(name))[1] = (select public.gym_id())::text)$p$;
  end if;
end $$;

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
