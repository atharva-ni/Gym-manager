-- =====================================================================
-- Migration 008: member photos (members.photo_path and a private
-- "member-photos" storage bucket).
-- Run this ONCE in the Supabase SQL Editor after 007. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

alter table public.members add column if not exists photo_path text;   -- photo in the member-photos bucket

-- member_overview selects m.*, so it has to be rebuilt to include the new column
drop view if exists public.member_overview;
create view public.member_overview
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

-- Private storage bucket for member photos (Supabase only; skipped elsewhere).
-- 009_staff_and_activity.sql widens this so staff can see photos at check-in.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('member-photos', 'member-photos', false) on conflict (id) do nothing;
    execute 'drop policy if exists "member_photos_owner" on storage.objects';
    execute $p$create policy "member_photos_owner" on storage.objects for all to authenticated
              using (bucket_id = 'member-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
              with check (bucket_id = 'member-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;
