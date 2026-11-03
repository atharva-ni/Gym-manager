-- =====================================================================
-- Migration 010: plans with durations (1 / 3 / 6 / 12 calendar months per
-- plan), one admission fee in Settings, staff can admit / renew / sell day
-- passes and give discounts (optionally capped), and exact Fees page totals.
-- Run this ONCE in the Supabase SQL Editor after 009. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

-- 1. New columns
alter table public.plans add column if not exists duration_months int check (duration_months between 1 and 36);
alter table public.gym_settings add column if not exists admission_fee numeric(12,2) not null default 0 check (admission_fee >= 0);
alter table public.gym_settings add column if not exists staff_max_discount_pct numeric(5,2) check (staff_max_discount_pct between 0 and 100);

-- A staff login can belong to a person on the Staff page
alter table public.staff_accounts add column if not exists trainer_id uuid references public.trainers on delete set null;
create unique index if not exists staff_accounts_trainer_key on public.staff_accounts (trainer_id) where trainer_id is not null;

-- 2. Existing 30 / 90 / 180 / 365-day plans become 1 / 3 / 6 / 12 months
update public.plans
   set duration_months = case duration_days when 30 then 1 when 31 then 1 when 60 then 2 when 90 then 3
                                             when 180 then 6 when 360 then 12 when 365 then 12 end
 where kind in ('membership', 'personal_training') and duration_months is null;

-- 3. The admission fee moves from each plan to Settings (one fee for the gym)
update public.gym_settings g set admission_fee = p.fee
  from (select owner_id, max(admission_fee) fee from public.plans group by owner_id) p
 where p.owner_id = g.owner_id and p.fee > 0;
update public.plans set admission_fee = 0 where admission_fee <> 0;

-- 4. Staff can admit, renew, sell day passes and give discounts
do $$
declare t text;
begin
  -- Staff: read what the member list, check-in, admissions and fees need
  foreach t in array array['gym_settings','plans','members','memberships','payments','refunds',
                           'membership_freezes','attendance'] loop
    execute format('drop policy if exists "staff_read" on public.%I', t);
    execute format('create policy "staff_read" on public.%I for select to authenticated
                    using (owner_id = (select public.gym_id()))', t);
  end loop;
  -- ...check members in, admit and renew members, collect fees, log walk-in trials...
  foreach t in array array['attendance','payments','members','memberships','leads'] loop
    execute format('drop policy if exists "staff_insert" on public.%I', t);
    execute format('create policy "staff_insert" on public.%I for insert to authenticated
                    with check (owner_id = (select public.gym_id()))', t);
  end loop;
  -- ...check out, update member details, and set due dates / discounts on fees
  -- (staff_limits keeps fee changes to those fields)
  foreach t in array array['attendance','memberships','members'] loop
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

-- What staff may write:
--   * a new plan / PT / pass only at the plan's listed price, and the
--     admission fee only at the amount in Settings;
--   * on an existing fee only the due date, discount and notes;
--   * on a visit only the check-out time;
--   * discounts up to "Max discount staff can give" in Settings, if set.
create or replace function public.staff_limits()
returns trigger language plpgsql set search_path = public as $$
declare
  v_allowed text[];
  v_cap     numeric;
  v_price   numeric;
begin
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  if tg_table_name = 'memberships' then
    if tg_op = 'INSERT' then
      if new.kind = 'charge' then
        select admission_fee into v_price from gym_settings where owner_id = new.owner_id;
        if new.plan_name <> 'Admission fee' or new.price <> coalesce(v_price, 0) then
          raise exception 'Staff can only add the admission fee set in Settings' using errcode = '42501';
        end if;
      else
        select price into v_price from plans where id = new.plan_id and kind = new.kind;
        if v_price is null or new.price <> v_price then
          raise exception 'Staff can only sell plans at their listed price' using errcode = '42501';
        end if;
      end if;
    else
      v_allowed := array['balance_due_on', 'discount', 'notes', 'updated_at'];
      if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
        raise exception 'Only the owner can make this change' using errcode = '42501';
      end if;
    end if;
    select staff_max_discount_pct into v_cap from gym_settings where owner_id = new.owner_id;
    if v_cap is not null and new.discount > round(new.price * v_cap / 100, 2) + 0.01
       and (tg_op = 'INSERT' or new.discount > old.discount) then
      raise exception 'Staff can give at most % %% discount. Ask the owner for more.', v_cap using errcode = '42501';
    end if;
    return new;
  end if;

  -- attendance
  if (to_jsonb(new) - 'check_out') is distinct from (to_jsonb(old) - 'check_out') then
    raise exception 'Only the owner can make this change' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_memberships_staff on public.memberships;
create trigger trg_memberships_staff before insert or update on public.memberships
  for each row execute function public.staff_limits();
drop trigger if exists trg_attendance_staff on public.attendance;
create trigger trg_attendance_staff before update on public.attendance
  for each row execute function public.staff_limits();

-- Trainer names for the PT picker. Staff can't read the trainers table
-- (it holds salaries), so this returns only id and name.
create or replace function public.trainer_options()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.full_name from trainers t
   where t.owner_id = public.gym_id() and t.status = 'active'
   order by t.full_name;
$$;

-- 5. Plans with durations, Fees page totals, plan report
-- ---------------------------------------------------------------------
-- Plans with durations. A plan (e.g. "Silver") is every row of `plans`
-- with the same kind and name; each row is one duration / price option.
-- ---------------------------------------------------------------------

-- Create or edit a plan and all its options in one go (owner only).
-- p_options: [{id?, duration_months?, duration_days?, price, sessions?, active?}]
-- Options left out are deleted, or switched off if they were ever sold.
create or replace function public.save_plan_group(
  p_kind text, p_old_name text, p_name text, p_description text, p_active boolean, p_options jsonb
) returns void
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_opt    jsonb;
  v_id     uuid;
  v_months int;
  v_days   int;
  v_keep   uuid[] := '{}';
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change plans' using errcode = '42501';
  end if;
  if p_kind not in ('membership', 'personal_training', 'pass') then
    raise exception 'Unknown plan type';
  end if;
  if v_name = '' then
    raise exception 'Give the plan a name';
  end if;
  if p_options is null or jsonb_array_length(p_options) = 0 then
    raise exception 'Add at least one duration with a price';
  end if;
  if exists (select 1 from plans
              where kind = p_kind and lower(name) = lower(v_name)
                and (p_old_name is null or name <> p_old_name)) then
    raise exception 'There is already a plan called %', v_name;
  end if;
  if (select count(*) from jsonb_array_elements(p_options))
     <> (select count(distinct coalesce('m' || (o->>'duration_months'), 'd' || (o->>'duration_days')))
           from jsonb_array_elements(p_options) o) then
    raise exception 'Each duration can only be listed once';
  end if;

  if p_old_name is not null then
    update plans set name = v_name where kind = p_kind and name = p_old_name;
  end if;

  for v_opt in select * from jsonb_array_elements(p_options) loop
    v_months := nullif(v_opt->>'duration_months', '')::int;
    v_days := coalesce(nullif(v_opt->>'duration_days', '')::int, v_months * 30);
    if v_days is null or v_days < 1 then
      raise exception 'Every option needs a duration';
    end if;
    if coalesce((v_opt->>'price')::numeric, -1) < 0 then
      raise exception 'Every option needs a price';
    end if;
    v_id := nullif(v_opt->>'id', '')::uuid;
    if v_id is not null then
      update plans
         set duration_months = v_months, duration_days = v_days, price = (v_opt->>'price')::numeric,
             sessions = nullif(v_opt->>'sessions', '')::int, description = nullif(trim(p_description), ''),
             is_active = p_active and coalesce((v_opt->>'active')::boolean, true)
       where id = v_id and kind = p_kind and name = v_name;
      if not found then
        v_id := null;
      end if;
    end if;
    if v_id is null then
      insert into plans (name, kind, duration_months, duration_days, price, sessions, description, is_active)
      values (v_name, p_kind, v_months, v_days, (v_opt->>'price')::numeric, nullif(v_opt->>'sessions', '')::int,
              nullif(trim(p_description), ''), p_active and coalesce((v_opt->>'active')::boolean, true))
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  -- Options taken out of the plan
  update plans set is_active = false
   where kind = p_kind and name = v_name and id <> all (v_keep)
     and exists (select 1 from memberships m where m.plan_id = plans.id);
  delete from plans
   where kind = p_kind and name = v_name and id <> all (v_keep)
     and not exists (select 1 from memberships m where m.plan_id = plans.id);
end $$;

-- Remove a plan: options never sold are deleted, sold ones switched off.
create or replace function public.delete_plan_group(p_kind text, p_name text)
returns void
language plpgsql volatile security invoker set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change plans' using errcode = '42501';
  end if;
  update plans set is_active = false
   where kind = p_kind and name = p_name and exists (select 1 from memberships m where m.plan_id = plans.id);
  delete from plans
   where kind = p_kind and name = p_name and not exists (select 1 from memberships m where m.plan_id = plans.id);
end $$;

-- Fees page totals for any date range (no row limit)
create or replace function public.payments_summary(p_from date, p_to date, p_method text default null, p_category text default null)
returns json
language sql stable security invoker set search_path = public as $$
  with p as (
    select amount, method from payments
     where paid_on between p_from and p_to
       and (p_method is null or method = p_method)
       and (p_category is null or category = p_category)
       and p_category is distinct from 'refund'
  ), r as (
    select amount from refunds
     where refunded_on between p_from and p_to
       and (p_method is null or method = p_method)
       and (p_category is null or p_category = 'refund')
  ), top as (
    select method, sum(amount) total from p group by method order by 2 desc limit 1
  )
  select json_build_object(
    'received', (select coalesce(sum(amount), 0) from p),
    'payments', (select count(*) from p),
    'refunded', (select coalesce(sum(amount), 0) from r),
    'top_method', (select method from top),
    'top_amount', (select total from top));
$$;

create or replace function public.plan_breakdown(p_from date, p_to date)
returns table (plan_name text, sold bigint, revenue numeric)
language sql stable security invoker set search_path = public as $$
  select split_part(plan_name, ' · ', 1), count(*), sum(price - discount) from memberships
   where start_date between p_from and p_to and status <> 'cancelled' and kind <> 'charge'
   group by 1 order by 3 desc;
$$;

-- 6. Member photos: staff can add them too
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    execute 'drop policy if exists "member_photos_owner" on storage.objects';
    execute 'drop policy if exists "member_photos_staff_read" on storage.objects';
    execute 'drop policy if exists "member_photos_gym" on storage.objects';
    execute $p$create policy "member_photos_gym" on storage.objects for all to authenticated
              using (bucket_id = 'member-photos' and (storage.foldername(name))[1] = (select public.gym_id())::text)
              with check (bucket_id = 'member-photos' and (storage.foldername(name))[1] = (select public.gym_id())::text)$p$;
  end if;
end $$;
