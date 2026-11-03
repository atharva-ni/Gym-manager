-- =====================================================================
-- Migration 015: the owner sets a staff member's password (new login or
-- reset), and the email counts as confirmed, so staff can sign in at once
-- with no email verification. Owner only; never an owner's account.
-- Run this ONCE in the Supabase SQL Editor after 014. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

create or replace function public.set_staff_password(p_staff_id uuid, p_password text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  s staff_accounts;
  n int;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can set staff passwords' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Use a password of at least 8 characters';
  end if;
  select * into s from staff_accounts where id = p_staff_id and owner_id = auth.uid();
  if not found then
    raise exception 'Staff login not found';
  end if;
  -- Supabase keeps pgcrypto in the "extensions" schema; bcrypt like Supabase Auth
  update auth.users u
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(u.email_confirmed_at, now()),
         updated_at = now()
   where (u.id = s.user_id or lower(u.email) = lower(s.email))
     and not exists (select 1 from gym_settings g where g.owner_id = u.id);
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'This staff member has no sign-in account yet';
  end if;
end $$;

revoke all on function public.set_staff_password(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.set_staff_password(uuid, text) from anon';
    execute 'grant execute on function public.set_staff_password(uuid, text) to authenticated';
  end if;
end $$;

-- Make the API see the new function straight away
notify pgrst, 'reload schema';
