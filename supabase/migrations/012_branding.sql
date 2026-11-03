-- =====================================================================
-- Migration 012: gym logo (shown in the menu, on receipts and the sign-in
-- screen) and the gym name on the sign-in screen.
-- Run this ONCE in the Supabase SQL Editor after 011. Safe to re-run.
-- Fresh installs only need schema.sql.
-- =====================================================================

alter table public.gym_settings add column if not exists logo_path text;

-- Gym name and logo for the sign-in screen and shared receipts (nothing else)
create or replace function public.gym_public_brand()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', gym_name, 'logo_path', logo_path)
    from gym_settings order by updated_at limit 1;
$$;
revoke all on function public.gym_public_brand() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.gym_public_brand() to anon, authenticated';
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    -- Gym logo: public to read (receipts, sign-in), only the owner can change it
    insert into storage.buckets (id, name, public) values ('brand', 'brand', true) on conflict (id) do update set public = true;
    execute 'drop policy if exists "brand_owner" on storage.objects';
    execute $p$create policy "brand_owner" on storage.objects for all to authenticated
              using (bucket_id = 'brand' and (storage.foldername(name))[1] = (select public.gym_id())::text
                     and (select public.is_owner()))
              with check (bucket_id = 'brand' and (storage.foldername(name))[1] = (select public.gym_id())::text
                          and (select public.is_owner()))$p$;
  end if;
end $$;
