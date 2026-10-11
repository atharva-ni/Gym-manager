-- =====================================================================
-- Optional demo data for an Indian gym (INR, Asia/Kolkata). Run AFTER
-- schema.sql and AFTER creating your owner user (Authentication > Users).
-- It attaches everything to that user. Change the email below to your
-- owner account's email. Safe to skip in production.
-- =====================================================================
do $$
declare
  owner_email text := 'owner@example.com';   -- change me
  uid uuid;
  p_monthly uuid; p_quarter uuid; p_half uuid; p_annual uuid; p_pt uuid; p_pt3 uuid;
  t1 uuid; t2 uuid; t3 uuid;
  m record;
  ms_id uuid;
  plan record;
  start_d date;
  i int;
  names text[] := array[
    'Aarav Sharma','Priya Patel','Rohan Gupta','Sneha Reddy','Arjun Nair','Kavya Iyer','Vikas Yadav','Ananya Singh',
    'Rahul Verma','Isha Kapoor','Aditya Joshi','Meera Pillai','Siddharth Rao','Neha Agarwal','Karthik Menon','Pooja Desai',
    'Amit Chauhan','Riya Malhotra','Harsh Pandey','Diya Bhatt','Nikhil Saxena','Tanvi Kulkarni','Yash Thakur','Simran Kaur',
    'Manish Tiwari','Aishwarya Shetty','Gaurav Mishra','Shreya Banerjee','Varun Khanna','Nandini Ghosh'];
begin
  if to_regclass('public.gym_settings') is null or to_regprocedure('public.dashboard_stats(date,int,timestamptz,timestamptz)') is null then
    raise exception 'Tables not found. Run supabase/schema.sql in this project first, then run this seed.';
  end if;

  select id into uid from auth.users where email = owner_email;
  if uid is null then
    select id into uid from auth.users order by created_at limit 1;
  end if;
  if uid is null then
    raise exception 'No users found. Create your owner account first (Authentication > Users).';
  end if;

  insert into public.gym_settings (owner_id, gym_name, phone, email, address, currency, timezone, tax_rate)
  values (uid, 'SetFit Fitness', '+91 88559 98620', null,
          'Beside The Tree House High School, DP Road, Karvenagar, Pune, Maharashtra 411052', 'INR', 'Asia/Kolkata', 18)
  on conflict (owner_id) do nothing;

  insert into public.plans (owner_id, name, duration_days, price, admission_fee, description)
    values (uid, 'Monthly', 30, 1500, 500, 'Full gym access, locker') returning id into p_monthly;
  insert into public.plans (owner_id, name, duration_days, price, admission_fee, description)
    values (uid, 'Quarterly', 90, 4000, 500, 'Full gym access + 1 PT intro session') returning id into p_quarter;
  insert into public.plans (owner_id, name, duration_days, price, admission_fee, description)
    values (uid, 'Half-yearly', 180, 7500, 0, 'Full gym access + group classes') returning id into p_half;
  insert into public.plans (owner_id, name, duration_days, price, admission_fee, description)
    values (uid, 'Annual', 365, 13000, 0, 'Everything included, 2 guest passes per month') returning id into p_annual;
  insert into public.plans (owner_id, name, kind, sessions, duration_days, price, description)
    values (uid, 'PT 12 sessions', 'personal_training', 12, 30, 6000, 'One-on-one training, 3 sessions a week') returning id into p_pt;
  insert into public.plans (owner_id, name, kind, sessions, duration_days, price, description)
    values (uid, 'PT 36 sessions', 'personal_training', 36, 90, 15000, 'Three months of one-on-one coaching + diet plan') returning id into p_pt3;

  insert into public.trainers (owner_id, full_name, phone, role, specialization, salary, joined_on) values
    (uid, 'Vikram Singh', '+91 98100 00111', 'Head Coach', 'Strength & powerlifting', 35000, current_date - 400) returning id into t1;
  insert into public.trainers (owner_id, full_name, phone, role, specialization, salary, joined_on) values
    (uid, 'Ananya Iyer', '+91 98100 00112', 'Trainer', 'Yoga & mobility', 25000, current_date - 250) returning id into t2;
  insert into public.trainers (owner_id, full_name, phone, role, specialization, salary, joined_on) values
    (uid, 'Karan Mehta', '+91 98100 00113', 'Trainer', 'HIIT & conditioning', 22000, current_date - 120) returning id into t3;
  update public.trainers set pt_commission_pct = 40 where id in (t2, t3);
  insert into public.trainers (owner_id, full_name, phone, role, salary, joined_on) values
    (uid, 'Pooja Verma', '+91 98100 00114', 'Receptionist', 15000, current_date - 300);

  -- Members, each with a membership history
  for i in 1 .. array_length(names, 1) loop
    insert into public.members (owner_id, full_name, phone, email, gender, date_of_birth, joined_on, trainer_id)
    values (
      uid, names[i],
      '+91 98' || lpad((10000000 + i * 7919)::text, 8, '0'),
      lower(replace(names[i], ' ', '.')) || '@mail.test',
      case when i % 2 = 0 then 'female' else 'male' end,
      (current_date - ((20 + i % 25) * 365 + i * 11))::date,
      (current_date - (i * 6))::date,
      case i % 4 when 0 then t1 when 1 then t2 when 2 then t3 else null end
    );
  end loop;

  for m in select * from public.members where owner_id = uid order by member_code loop
    select * into plan from public.plans
     where id = (array[p_monthly, p_monthly, p_quarter, p_half, p_annual])[1 + (abs(hashtext(m.full_name)) % 5)];
    start_d := m.joined_on;
    -- Keep renewing until the membership reaches the near future (some lapse)
    loop
      insert into public.memberships (owner_id, member_id, plan_id, plan_name, start_date, end_date, price, discount)
      values (uid, m.id, plan.id, plan.name, start_d, start_d + plan.duration_days - 1,
              plan.price + case when start_d = m.joined_on then plan.admission_fee else 0 end,
              case when abs(hashtext(m.full_name)) % 7 = 0 then 300 else 0 end)
      returning id into ms_id;

      -- Most pay in full; every 6th member leaves a balance on the latest plan
      insert into public.payments (owner_id, member_id, membership_id, amount, method, category, paid_on)
      select uid, m.id, ms_id,
             case when abs(hashtext(m.full_name)) % 6 = 0 and start_d + plan.duration_days > current_date
                  then round((x.price - x.discount) / 2, 2) else x.price - x.discount end,
             (array['upi','upi','cash','card'])[1 + (abs(hashtext(m.full_name || start_d)) % 4)],
             'membership', least(start_d, current_date)
        from public.memberships x where x.id = ms_id;

      start_d := start_d + plan.duration_days;
      exit when start_d > current_date or abs(hashtext(m.full_name || start_d)) % 5 = 0;
    end loop;
  end loop;

  -- Part payments: the rest is due 10 days after the plan started (some are now overdue)
  update public.memberships x set balance_due_on = x.start_date + 10
   where x.id in (select id from public.membership_balances where balance > 0);

  -- Personal training packages for six members, some part-paid
  for m in select * from public.members where owner_id = uid order by member_code limit 6 loop
    start_d := current_date - (abs(hashtext(m.full_name)) % 20);
    insert into public.memberships (owner_id, member_id, plan_id, plan_name, kind, trainer_id, sessions_total, sessions_used,
                                    start_date, end_date, price, balance_due_on)
    values (uid, m.id, p_pt, 'PT 12 sessions', 'personal_training',
            (array[t1, t2, t3])[1 + abs(hashtext(m.full_name)) % 3], 12, (current_date - start_d) / 3,
            start_d, start_d + 29, 6000,
            case when abs(hashtext(m.full_name)) % 2 = 0 then start_d + 10 end)
    returning id into ms_id;
    insert into public.payments (owner_id, member_id, membership_id, amount, method, category, paid_on)
    values (uid, m.id, ms_id, case when abs(hashtext(m.full_name)) % 2 = 0 then 3000 else 6000 end,
            'upi', 'personal_training', start_d);
  end loop;

  -- Attendance: last 45 days, about 60% of members visit on a given day.
  -- Hours are India time, converted to UTC for storage.
  insert into public.attendance (owner_id, member_id, check_in, check_out)
  select uid, mb.id,
         ts,
         case when d = 0 and random() < 0.3 then null else ts + ((45 + floor(random() * 60))::int || ' minutes')::interval end
    from public.members mb
    cross join generate_series(0, 44) d
    cross join lateral (
      select ((current_date - d)::timestamp
             + make_interval(hours => (array[5,6,6,7,7,8,17,18,19,20])[1 + floor(random() * 10)::int],
                             mins => floor(random() * 60)::int)) at time zone 'Asia/Kolkata' as ts
    ) t
   where mb.owner_id = uid
     and mb.joined_on <= current_date - d
     and random() < 0.6
     and (d > 0 or t.ts < now());

  -- Classes
  insert into public.classes (owner_id, name, trainer_id, day_of_week, start_time, end_time, capacity, room)
  select uid, c.name, c.tr, c.dow, c.st::time, c.en::time, c.cap, c.room
    from (values
      ('Morning Yoga', t2, 1, '06:30', '07:30', 15, 'Studio A'), ('HIIT Blast', t3, 1, '18:00', '18:45', 20, 'Main floor'),
      ('Powerlifting Club', t1, 2, '19:00', '20:30', 10, 'Platform'), ('Zumba', t3, 3, '07:00', '07:45', 25, 'Studio A'),
      ('Morning Yoga', t2, 3, '06:30', '07:30', 15, 'Studio A'), ('HIIT Blast', t3, 4, '18:00', '18:45', 20, 'Main floor'),
      ('Mobility & Stretch', t2, 5, '17:30', '18:15', 15, 'Studio A'), ('Powerlifting Club', t1, 6, '10:00', '11:30', 10, 'Platform'),
      ('Bootcamp', t3, 6, '07:00', '08:00', 25, 'Terrace'), ('Sunday Yoga', t2, 0, '07:00', '08:00', 15, 'Studio A')
    ) as c(name, tr, dow, st, en, cap, room);

  -- Expenses for the last 6 months
  for i in 0 .. 5 loop
    insert into public.expenses (owner_id, category, amount, spent_on, vendor, description, method) values
      (uid, 'rent',      15000, (date_trunc('month', current_date) - (i || ' months')::interval)::date + 1, 'Gupta Properties', 'Monthly rent', 'bank'),
      (uid, 'salary',    25000, least((date_trunc('month', current_date) - (i || ' months')::interval)::date + 27, current_date), 'Payroll', 'Staff salaries', 'bank'),
      (uid, 'utilities', 4000 + floor(random() * 2000), least((date_trunc('month', current_date) - (i || ' months')::interval)::date + 10, current_date), 'Electricity Board', 'Electricity + water', 'upi'),
      (uid, 'marketing', 1500 + floor(random() * 2000), least((date_trunc('month', current_date) - (i || ' months')::interval)::date + 15, current_date), 'Meta Ads', 'Instagram ads', 'card');
  end loop;
  insert into public.expenses (owner_id, category, amount, spent_on, vendor, description) values
    (uid, 'maintenance', 3500, current_date - 40, 'FitCare Services', 'Treadmill belt replacement'),
    (uid, 'equipment', 85000, current_date - 95, 'Cosco India', 'New squat rack');

  -- Products & POS sales
  insert into public.products (owner_id, name, sku, category, price, cost, stock, low_stock_level) values
    (uid, 'Whey Protein 1kg', 'WP-1K', 'supplement', 2499, 1800, 14, 5),
    (uid, 'Protein Bar', 'PB-01', 'supplement', 120, 70, 60, 15),
    (uid, 'Energy Drink', 'ED-01', 'beverage', 99, 55, 4, 12),
    (uid, 'Water Bottle 1L', 'WB-01', 'beverage', 20, 8, 90, 24),
    (uid, 'Gym T-shirt', 'TS-01', 'apparel', 599, 250, 22, 5),
    (uid, 'Lifting Straps', 'LS-01', 'accessory', 399, 150, 3, 4);
  insert into public.sales (owner_id, product_id, product_name, member_id, quantity, unit_price, unit_cost, method, sold_on)
  select uid, p.id, p.name,
         (select id from public.members where owner_id = uid order by random() limit 1),
         1 + floor(random() * 3)::int, p.price, p.cost,
         (array['upi','cash','upi'])[1 + floor(random() * 3)::int],
         current_date - floor(random() * 150)::int
    from public.products p cross join generate_series(1, 8)
   where p.owner_id = uid and p.stock > 10;

  -- Equipment
  insert into public.equipment (owner_id, name, category, brand, quantity, purchase_date, purchase_cost, status, last_service, next_service) values
    (uid, 'Treadmill', 'cardio', 'Life Fitness T5', 6, current_date - 700, 1200000, 'working', current_date - 40, current_date + 50),
    (uid, 'Spin Bike', 'cardio', 'Keiser M3i', 12, current_date - 500, 600000, 'working', current_date - 100, current_date + 3),
    (uid, 'Rowing Machine', 'cardio', 'Concept2', 4, current_date - 400, 250000, 'needs_service', current_date - 200, current_date - 10),
    (uid, 'Squat Rack', 'strength', 'Cosco', 4, current_date - 95, 340000, 'working', null, current_date + 270),
    (uid, 'Dumbbell Set 2.5-50kg', 'free_weights', 'Aerofit', 1, current_date - 800, 150000, 'working', null, null),
    (uid, 'Cable Crossover', 'machines', 'Hammer Strength', 1, current_date - 650, 220000, 'out_of_order', current_date - 150, current_date - 5);

  -- Leads
  insert into public.leads (owner_id, full_name, phone, source, interest, status, follow_up_on, notes) values
    (uid, 'Abhishek Jain', '+91 98200 12001', 'instagram', 'Weight loss', 'new', current_date, 'Saw the Diwali offer'),
    (uid, 'Lakshmi Narayan', '+91 98200 12002', 'referral', 'Personal training', 'contacted', current_date - 1, 'Referred by Priya Patel'),
    (uid, 'Mohit Arora', '+91 98200 12003', 'walk_in', 'Powerlifting', 'trial', current_date + 2, 'On a 3-day trial'),
    (uid, 'Divya Krishnan', '+91 98200 12004', 'google', 'Yoga classes', 'new', current_date + 1, null),
    (uid, 'Sunil Rawat', '+91 98200 12005', 'facebook', 'General fitness', 'lost', null, 'Chose a gym closer to home'),
    (uid, 'Ritika Sood', '+91 98200 12006', 'website', 'Zumba', 'contacted', current_date + 4, null),
    (uid, 'Deepak Chawla', '+91 98200 12007', 'walk_in', 'Muscle gain', 'converted', null, null);

  -- Progress measurements for a few members
  insert into public.measurements (owner_id, member_id, measured_on, weight_kg, height_cm, body_fat_pct, waist_cm)
  select uid, mb.id, current_date - w * 30, 82 - (5 - w) * 1.3 + (abs(hashtext(mb.full_name)) % 10), 172, 24 - (5 - w) * 0.6, 90 - (5 - w)
    from (select * from public.members where owner_id = uid order by member_code limit 5) mb
    cross join generate_series(0, 5) w;
  -- Receipt numbers for the demo payments, in date order
  with numbered as (
    select id, row_number() over (order by paid_on, created_at) as rn
    from public.payments where owner_id = uid and receipt_no is null
  )
  update public.payments p
     set receipt_no = 'R-' || lpad((n.rn + coalesce((
           select max(substring(x.receipt_no from 3)::int) from public.payments x
            where x.owner_id = uid and x.receipt_no ~ '^R-[0-9]+$'), 0))::text, 5, '0')
    from numbered n where n.id = p.id;
end $$;
