-- =====================================================================
-- Migration 011: front-desk fixes. "Joined" follows the member's first
-- plan, staff can log PT sessions, and a day close (cash / UPI / card
-- totals for one day).
-- Run this ONCE in the Supabase SQL Editor after 010. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

-- 1. Joined date: never later than the member's first plan
update public.members m set joined_on = f.first_start
  from (select member_id, min(start_date) first_start from public.memberships
         where kind in ('membership', 'personal_training', 'pass') group by member_id) f
 where f.member_id = m.id and f.first_start < m.joined_on;

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
  -- "Joined" is never later than the member's first plan (e.g. entering a past admission)
  update members set joined_on = l.first_start
    from (select min((l->>'start_date')::date) first_start from jsonb_array_elements(p_lines) l
           where coalesce(l->>'kind', 'membership') in ('membership', 'personal_training', 'pass')) l
   where id = p_member_id and l.first_start < joined_on;
  return record_payments(v_rows);
end $$;

-- 2. Staff can log PT sessions (not undo them)
drop policy if exists "staff_read" on public.pt_sessions;
create policy "staff_read" on public.pt_sessions for select to authenticated
  using (owner_id = (select public.gym_id()));
drop policy if exists "staff_insert" on public.pt_sessions;
create policy "staff_insert" on public.pt_sessions for insert to authenticated
  with check (owner_id = (select public.gym_id()));

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
      v_allowed := array['balance_due_on', 'discount', 'notes', 'sessions_used', 'updated_at'];
      if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed)
         or new.sessions_used < old.sessions_used then
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

-- 3. Day close
-- Day close (owner only): money in and out on one day, by payment mode
create or replace function public.day_close(p_day date)
returns table (method text, received numeric, refunded numeric, sales numeric, net numeric, entries bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can see the day close' using errcode = '42501';
  end if;
  return query
  with x as (
    select p.method, p.amount as received, 0::numeric as refunded, 0::numeric as sales from payments p where p.paid_on = p_day
    union all
    select r.method, 0, r.amount, 0 from refunds r where r.refunded_on = p_day
    union all
    select coalesce(s.method, 'cash'), 0, 0, s.total from sales s where s.sold_on = p_day and not s.on_credit
  )
  select x.method, sum(x.received), sum(x.refunded), sum(x.sales), sum(x.received - x.refunded + x.sales), count(*)
    from x group by x.method order by 5 desc;
end $$;
