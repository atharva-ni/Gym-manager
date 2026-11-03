-- =====================================================================
-- Migration 013: link each staff login to its person on the Staff page.
-- (This was added to 010 after it was first published; databases that ran
-- the earlier 010 need it.) Run once in the Supabase SQL Editor. Safe to
-- re-run. Fresh installs only need schema.sql.
-- =====================================================================

alter table public.staff_accounts add column if not exists trainer_id uuid references public.trainers on delete set null;
create unique index if not exists staff_accounts_trainer_key on public.staff_accounts (trainer_id) where trainer_id is not null;

-- Make the API see the new column straight away
notify pgrst, 'reload schema';
