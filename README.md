# SetFit Fitness: Gym Manager

A gym management system for the owner and front-desk staff, built with **Next.js 16** (App Router, Server Actions) and **Supabase** (Postgres + Auth + Row Level Security).

## Features

| Area | What you get |
| --- | --- |
| **Dashboard** | Active members, today's check-ins and who's inside, month revenue & net profit, alerts for expiring/expired plans, outstanding dues, lead follow-ups, low stock and equipment faults, 6-month revenue vs expenses chart, today's classes, birthdays |
| **Members** | Searchable, filterable list (active / expiring / expired / with dues / frozen / inactive), auto member codes (`M-0001`), **member photo** (camera or gallery, shrunk before upload, private storage; shown in the list, on the profile and at check-in), full profile with emergency contact and medical notes, assigned trainer |
| **Memberships** | Sell or renew plans with discounts and admission fees, partial payments with running balance, full history. **Freeze** with dates (end date moves out automatically, resumes on its own, early resume gives days back). **Change / upgrade plan** with credit for unused paid days. **Refund / cancel** with a suggested pro-rata refund. Extend for compensation days. |
| **Admission & billing** | One "New admission" screen: member basics and photo (more details optional), pick the plan then its duration (Silver → 1 / 3 / 6 / 12 months, with ₹/month and the saving shown) and/or a PT package with trainer, "valid till" date, the one-time admission fee as its own line, discount in ₹ or % with a reason, paid now (full, half, part or nothing, by one or **two payment modes** such as cash + UPI), payment date (for entering past paperwork) and balance due date, with a live bill summary (sticky total and Save on phones). **Duplicate mobile check** with a family override. Renew / add plan and Add PT use the same bill. Sequential receipt numbers (R-00001), one receipt per bill. |
| **Fees & payments** | Every payment belongs to a member and is applied to their membership or PT fee. **All pending fees** can be paid together on one receipt (oldest first). **Day close**: cash / UPI / card totals for any day with who took each payment, and today's cash on the dashboard. Pending dues list with one-click collect, discount / waive-off on a balance, WhatsApp reminders, overpayment blocked, receipts showing fee, paid and balance. Payments, refunds and sales are never deleted: the owner **voids** them with a reason |
| **Personal training** | PT packages (e.g. 12 sessions / 30 days) sold with a trainer, dated session log with history, PT dues, trainer PT clients, PT revenue and commission added to salary payouts |
| **Receipts** | Numbered receipts for payments (R-), counter sales (S-) and refund notes (RF-). **Send on WhatsApp** shares a link the member can open without logging in (set `NEXT_PUBLIC_SITE_URL` to your live address so links work outside your PC). |
| **Attendance** | Quick check-in with member search that shows the member's photo, plan, expiry and dues before letting them in ("Check in anyway" for expired / frozen), check-out, **day pass / trial sales** for walk-ins, day-by-day log, busiest hours chart |
| **Progress** | Body measurements, BMI and weight trend per member |
| **Plans** | Each plan (e.g. Silver, Gold, PT 12 sessions / month) holds its durations and prices in one place: 1, 3, 6, 12 months (calendar months: 15 Jan + 1 month runs to 14 Feb) or days for passes. Shows ₹/month, saving vs monthly and active members per duration. Durations already sold are switched off, never deleted. The admission fee is set once in Settings |
| **Staff** | One card per trainer or employee: contact, assigned members/classes, PT clients and sessions, salary + PT commission with "paid this month", one-click salary payout (booked as an expense, with history), and their app login |
| **Classes** | Weekly timetable with trainer, room and capacity; book members into a class date, capacity enforced, mark attended or cancel |
| **Expenses** | Categorised spending with breakdown chart, bill photo / PDF upload (private storage), recurring monthly expenses added with one click |
| **Inventory & POS** | Products with stock, cost and margin, low-stock alerts, restock (optionally booked as an expense), front-desk sales that decrement stock automatically, numbered sale receipts, sell on credit (added to the member's dues) |
| **Equipment** | Asset register, condition, service schedule, full service history (cost booked as maintenance expense) |
| **Leads** | Enquiry pipeline (new → contacted → trial → converted/lost), follow-up reminders, source chart, one-click convert to member |
| **Reports** | P&L, revenue vs expenses by month, revenue by method/category, expenses by category, plan performance, new members, lapsed members, attendance by weekday/hour, product profitability |
| **Staff logins** | Two roles only: **owner** (everything) and **staff**. On the **Staff** page the owner gives a person an app login ("Give app login"). Staff can check members in and out, take new admissions, renew, add PT, sell day passes, collect fees and give discounts (up to an optional limit set on the Staff page), and edit member details. They sell only at the listed prices and can't see reports, expenses or salaries, or freeze, refund, change plans, void or delete (enforced by the database). Switching a login off cuts access at once |
| **Activity log** | Every payment, refund, sale, plan or fee change, member edit and void, with who did it (owner or which staff member), when and why. Entries can't be edited or removed |
| **Settings** | Gym profile and **logo** (shown on receipts, the menu and the sign-in screen), rules (currency, timezone, expiry alert, freeze limits and fee), login email, change password, CSV export of all data. **Forgot password** on the sign-in page |

### Security model (owner + staff)

* There is no public sign-up page. The owner account is created once in the Supabase dashboard; staff logins are created by the owner inside the app.
* The database decides who may do what. The owner is the account that owns the gym (its `gym_settings` row); staff are the logins listed in `staff_accounts`. Every other account sees nothing.
* Every table has an `owner_id` column and Row Level Security: the owner has full access; staff can read members / plans / fees and add members, bills, check-ins, payments and walk-in leads. A trigger (`staff_limits`) keeps staff to the listed plan price and admission fee, the discount limit, and edits of due date, discount and check-out time only. Expenses, salaries, trainers, sales, reports and settings stay owner-only.
* Payments, refunds and sales can only be removed through `void_record()` (owner only, reason required). Triggers write every change to `activity_log`, which can't be edited from the app.
* Changing the owner's login email needs no other change: the gym is tied to the account, not the email.
* `src/proxy.ts` refreshes the Supabase session and redirects signed-out visitors to `/login`.

## Setup

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. Open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it.
3. Go to **Authentication → Users → Add user → Create new user**. Enter the owner's email and password and tick **Auto Confirm User**.
4. Go to **Authentication → Sign In / Providers** and turn off **Allow new users to sign up**, so nobody else can create an account.
5. *(Optional)* To load demo data, open [`supabase/seed.sql`](supabase/seed.sql), change `owner_email` to your owner's email and run it in the SQL Editor.

### Updating an existing database

If you ran `schema.sql` before an update, run the new files in [`supabase/migrations`](supabase/migrations) once, in order, in the SQL Editor:

1. `002_payments_and_pt.sql`
2. `003_receipts.sql`
3. `004_freeze_refunds_passes.sql`
4. `005_unfreeze_status.sql`
5. `006_operations.sql`
6. `007_performance_optimization.sql`
7. `008_member_photos.sql`
8. `009_staff_and_activity.sql`
9. `010_plan_options.sql` (plans with durations, one admission fee, staff selling, logins linked to staff)
10. `011_desk_fixes.sql` (joined date follows the first plan, staff log PT sessions, day close)
11. `012_branding.sql` (gym logo, gym name on the sign-in screen)
12. `013_staff_link.sql` (links staff logins to staff members; needed if you ran an early 010)
13. `014_staff_delete.sql` (deleting a staff member removes their login completely; salary history stays)
14. `015_staff_password.sql` (owner sets / resets staff passwords; no email verification for staff)

Each one is safe to run again, but run them in order: an older file run after 009 would put back the old owner-only access rules (run 009 again to fix that). The app shows a "Database update needed" banner naming the file when a migration is missing.

### 2. Configure the app

```bash
cp .env.example .env.local
```

Fill in the values from **Project Settings → API Keys**. Only the project URL and the **publishable** key are needed; the secret key is never used:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app
```

The publishable key is safe to expose. On its own it can't read any data, because Row Level Security only returns rows to the signed-in owner.

### 3. Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Sign in with the owner account, then open **Settings** to set your gym name, currency and timezone. On a brand-new database the first account to sign in becomes the owner.

### Staff logins (one-time setup)

1. In Supabase, **Authentication → Sign In / Providers**: turn **on** "Allow new users to sign up". The app needs it to create staff logins; accounts the owner didn't add get no access.
2. *(Optional, extra safety)* **Authentication → Hooks → Before User Created**: choose the Postgres function `public.hook_only_invited`. Sign-ups are then refused unless the owner added that email. Turn it off for a moment if you ever create a user in the dashboard. Without it, a stranger could create a login, but it sees no data and can't open the app.
3. **Authentication → URL Configuration**: keep the **Site URL** set to where the app runs (`http://localhost:3000` while testing, your Vercel address once deployed). Password-reset and confirmation links go back to that address, so no Redirect URL entries are needed.

Then on the **Staff** page, use **Give app login** on a person's card (email, temporary password). If "Confirm email" is on in Supabase, they click the emailed link once before signing in. The built-in Supabase mailer only sends a few emails per hour; for many staff or frequent resets, set up custom SMTP in **Authentication → Emails**.

### Changing the owner (login) email

Open **Settings → Login email**, enter the new address and click the confirmation link Supabase emails you (also to the old address if "Secure email change" is on). Nothing else needs changing.

### Forgot password

Use **Forgot password?** on the sign-in page. The link opens a page to choose a new password. It works for the owner and staff.

### Deploy (Vercel)

1. Push this repo to GitHub (already set up at `atharva-ni/Gym-manager`).
2. On [vercel.com](https://vercel.com) choose **Add New → Project**, import the repo, and add the environment variables from `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`). `OWNER_EMAILS` is no longer used and can be removed.
3. Deploy. In Supabase → **Authentication → URL Configuration**, set the Site URL to your Vercel address.

## Not built yet

* CSV import of existing members (for now: enter them with their real start date and payment date)
* GST tax invoice (GSTIN, SAC 999723, CGST / SGST split)
* Automatic / bulk WhatsApp reminders
* UPI AutoPay or Razorpay payments
* QR or biometric check-in
* Family / couple memberships, referral rewards
* Workout and diet plans, health waiver
* Member app (PWA)

## Tests

```bash
npm test          # billing maths + database tests (embedded Postgres, no Supabase needed)
npm run typecheck
npm run lint
```

The database tests load `schema.sql`, the seed and every migration into an embedded Postgres, and check row-level security, staff limits, voids and the activity log, all-or-nothing bills, receipt numbering, freezes, refunds, day passes, plan changes and the upgrade path from the first schema version. GitHub Actions runs lint, typecheck, tests and a build on every push (`.github/workflows/ci.yml`).

## Project structure

```
supabase/
  schema.sql          tables, triggers, views, RLS policies, reporting + transactional write functions
  seed.sql            optional demo data
  migrations/         upgrades for databases created with an older schema.sql
tests/                billing unit tests + database tests (node --test)
src/
  proxy.ts            session refresh + auth redirect (Next 16 "proxy", formerly middleware)
  lib/
    supabase/         server + proxy Supabase clients
    auth.ts           getAccess / requireAccess / requireOwner / getSettings
    photos.ts         member photo upload, signed links, file clean-up
    mutations.ts      runMutation(): auth check, error mapping, revalidation
    form.ts           FormData → typed row parser
    format.ts         money, dates, timezone helpers
    billing.ts        bill splits, payment-mode allocation, plan-change credit, refunds
  components/         UI kit, form dialogs, member picker, charts, sidebar
  app/
    login/            sign-in (owner and staff)
    forgot/, reset-password/, auth/confirm/   password reset
    (app)/            all authenticated pages (dashboard, members, payments, …)
    receipt/[id]/     printable receipt
    export/[table]/   CSV export route
```

## Notes

* Money totals and charts are computed in Postgres functions (`dashboard_stats`, `finance_monthly`, …) so they stay accurate regardless of row counts.
* Bills, fee collection, freezes and refunds are saved by Postgres functions (`save_bill`, `collect_fee`, `freeze_membership`, `refund_membership`) in one transaction each. Receipt numbers are assigned under a lock, so two saves at the same moment can't get the same number.
* Refunds are kept as their own records and subtracted in reports. Voiding a payment is only for mistakes; the activity log keeps the voided record.
* "Today", attendance days and hour-of-day charts use the timezone set in **Settings**.
* POS sales count as revenue alongside payments. Don't also record them as payments, or they'll be counted twice.
