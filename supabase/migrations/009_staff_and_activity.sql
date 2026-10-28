-- =====================================================================
-- Migration 009: staff logins, owner identity in the database (no more
-- OWNER_EMAILS), void with reason instead of deleting money records, and
-- an activity log of who changed what.
-- Run this ONCE in the Supabase SQL Editor after 008. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

-- 1. Every account that already has data becomes the owner of its gym
insert into public.gym_settings (owner_id)
select distinct owner_id from (
  select owner_id from public.members
  union select owner_id from public.plans
  union select owner_id from public.payments
) o
where owner_id is not null and exists (select 1 from auth.users u where u.id = o.owner_id)
on conflict (owner_id) do nothing;

-- 2. Staff accounts, access rules, activity log and void
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

-- 3. Receipt numbers: one sequence per gym, whether the owner or staff collects
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

-- 4. Shared receipt links of voided payments / sales say "cancelled"
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

-- 5. Storage: staff can view member photos; bills stay owner-only
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
