-- =====================================================================
-- Migration 014: delete a staff member's app login completely (their
-- sign-in account too), so the same email can be added again from
-- scratch. Owner only; past actions stay in the activity log.
-- Run this ONCE in the Supabase SQL Editor after 013. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

create or replace function public.delete_staff_login(p_staff_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  s staff_accounts;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can delete staff logins' using errcode = '42501';
  end if;
  select * into s from staff_accounts where id = p_staff_id and owner_id = auth.uid();
  if not found then
    raise exception 'Staff login not found';
  end if;
  delete from staff_accounts where id = s.id;
  -- The sign-in account: by link, or by email if they never signed in.
  -- Never an owner's account.
  delete from auth.users u
   where (u.id = s.user_id or lower(u.email) = lower(s.email))
     and not exists (select 1 from gym_settings g where g.owner_id = u.id);
end $$;

revoke all on function public.delete_staff_login(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.delete_staff_login(uuid) from anon';
    execute 'grant execute on function public.delete_staff_login(uuid) to authenticated';
  end if;
end $$;
