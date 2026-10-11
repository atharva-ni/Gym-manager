-- =====================================================================
-- Migration 005: "Resume now" also clears old manual "frozen" statuses,
-- and clear_frozen_status() unfreezes members frozen the old way.
-- Run this ONCE in the Supabase SQL Editor after 004. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

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
