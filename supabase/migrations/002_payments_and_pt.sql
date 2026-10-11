-- =====================================================================
-- Migration 002: member-linked payments, partial-payment due dates,
-- personal training packages.
-- Run this ONCE in the Supabase SQL Editor if you ran schema.sql before
-- this change. Fresh installs only need schema.sql.
-- =====================================================================

-- 1. Personal training: plan type + sessions, trainer commission, PT details on memberships
alter table public.plans add column if not exists kind text not null default 'membership';
alter table public.plans drop constraint if exists plans_kind_check;
alter table public.plans add constraint plans_kind_check check (kind in ('membership','personal_training'));
alter table public.plans add column if not exists sessions int check (sessions > 0);

alter table public.trainers add column if not exists pt_commission_pct numeric(5,2) not null default 50
  check (pt_commission_pct between 0 and 100);

alter table public.memberships add column if not exists kind text not null default 'membership';
alter table public.memberships drop constraint if exists memberships_kind_check;
alter table public.memberships add constraint memberships_kind_check check (kind in ('membership','personal_training'));
alter table public.memberships add column if not exists trainer_id uuid references public.trainers on delete set null;
alter table public.memberships add column if not exists sessions_total int check (sessions_total > 0);
alter table public.memberships add column if not exists sessions_used int not null default 0 check (sessions_used >= 0);
create index if not exists idx_memberships_trainer on public.memberships (trainer_id) where trainer_id is not null;

-- 2. Due date for the remaining balance of a partly paid fee
alter table public.memberships add column if not exists balance_due_on date;

-- 3. Every payment must belong to a member
do $$
begin
  if exists (select 1 from public.payments where member_id is null) then
    raise exception 'Some payments have no member. Link or delete them first: select * from payments where member_id is null;';
  end if;
end $$;
alter table public.payments alter column member_id set not null;
alter table public.payments drop constraint if exists payments_category_check;
alter table public.payments add constraint payments_category_check
  check (category in ('membership','admission','personal_training','product','other'));

-- 4. Members / memberships with payments can't be deleted (keeps the money trail)
alter table public.payments drop constraint if exists payments_member_id_fkey;
alter table public.payments add constraint payments_member_id_fkey
  foreign key (member_id) references public.members on delete restrict;
alter table public.payments drop constraint if exists payments_membership_id_fkey;
alter table public.payments add constraint payments_membership_id_fkey
  foreign key (membership_id) references public.memberships on delete restrict;

-- 5. Rebuild the views with the new columns
drop view if exists public.member_overview;
drop view if exists public.membership_balances;

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
  dues.next_due_on,
  pt.plan_name    as pt_plan_name,
  pt.end_date     as pt_end,
  pt.trainer_name as pt_trainer_name,
  la.last_visit
from public.members m
left join public.trainers t on t.id = m.trainer_id
left join lateral (
  select * from public.memberships x
  where x.member_id = m.id and x.status <> 'cancelled' and x.kind = 'membership'
  order by x.end_date desc
  limit 1
) lm on true
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

-- 6. Functions
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
  from trainers t;
$$;
