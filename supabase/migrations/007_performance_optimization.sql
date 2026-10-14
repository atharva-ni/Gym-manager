-- =====================================================================
-- Migration 007: Performance Optimizations
-- =====================================================================
-- 1. Missing indexes for fast balance calculation and membership lookups
-- 2. Fast lateral join for membership_balances (replaces full-table group by)
-- 3. Fast single-pass CTE aggregation for dashboard_stats
-- =====================================================================

-- 1. Indexes
create index if not exists idx_payments_membership on public.payments (membership_id);
create index if not exists idx_memberships_owner_status_kind on public.memberships (owner_id, status, kind, end_date);

-- 2. Optimized membership_balances view
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

-- 3. Optimized dashboard_stats function (single-pass CTE instead of 8 view scans)
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
    'inside_now',      (select count(*) from attendance
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
