# SetFit Fitness: Gym Manager

An owner-only gym management system built with **Next.js 16** (App Router, Server Actions) and **Supabase** (Postgres + Auth + Row Level Security).

## Features

| Area | What you get |
| --- | --- |
| **Dashboard** | Active members, today's check-ins and who's inside, month revenue & net profit, alerts for expiring/expired plans, outstanding dues, lead follow-ups, low stock and equipment faults, 6-month revenue vs expenses chart, today's classes, birthdays |
| **Members** | Searchable, filterable list (active / expiring / expired / with dues / frozen / inactive), auto member codes (`M-0001`), full profile with emergency contact and medical notes, assigned trainer |
| **Memberships** | Sell or renew plans with discounts and admission fees, partial payments with running balance, full history. **Freeze** with dates (end date moves out automatically, resumes on its own, early resume gives days back). **Change / upgrade plan** with credit for unused paid days. **Refund / cancel** with a suggested pro-rata refund. Extend for compensation days. |
| **Admission & billing** | One "New admission" screen: member basics (more details optional), gym plan and/or PT package with trainer, discount in ₹ or % with a reason, paid now (full, half, part or nothing, by one or **two payment modes** such as cash + UPI) and balance due date, with a live bill summary. **Duplicate mobile check** with a family override. Renew / add plan and Add PT use the same bill. Sequential receipt numbers (R-00001), one receipt per bill. |
| **Fees & payments** | Every payment belongs to a member and is applied to their membership or PT fee. Pending dues list with one-click collect, discount / waive-off on a balance, WhatsApp reminders, overpayment blocked, receipts showing fee, paid and balance |
| **Personal training** | PT packages (e.g. 12 sessions / 30 days) sold with a trainer, dated session log with history, PT dues, trainer PT clients, PT revenue and commission added to salary payouts |
| **Receipts** | Numbered receipts for payments (R-), counter sales (S-) and refund notes (RF-). **Send on WhatsApp** shares a link the member can open without logging in (set `NEXT_PUBLIC_SITE_URL` to your live address so links work outside your PC). |
| **Attendance** | Quick check-in with member search (warns about expired, frozen or unpaid members), check-out, **day pass / trial sales** for walk-ins, day-by-day log, busiest hours chart |
| **Progress** | Body measurements, BMI and weight trend per member |
| **Plans** | Gym memberships, PT packages and day passes / trials with duration, price, admission fee and active counts |
| **Staff** | Trainers & employees, assigned members/classes, payroll total, PT sessions per trainer, one-click salary payout (booked as an expense and kept as salary history per person) |
| **Classes** | Weekly timetable with trainer, room and capacity; book members into a class date, capacity enforced, mark attended or cancel |
| **Expenses** | Categorised spending with breakdown chart, bill photo / PDF upload (private storage), recurring monthly expenses added with one click |
| **Inventory & POS** | Products with stock, cost and margin, low-stock alerts, restock (optionally booked as an expense), front-desk sales that decrement stock automatically, numbered sale receipts, sell on credit (added to the member's dues) |
| **Equipment** | Asset register, condition, service schedule, full service history (cost booked as maintenance expense) |
| **Leads** | Enquiry pipeline (new → contacted → trial → converted/lost), follow-up reminders, source chart, one-click convert to member |
| **Reports** | P&L, revenue vs expenses by month, revenue by method/category, expenses by category, plan performance, new members, lapsed members, attendance by weekday/hour, product profitability |
| **Settings** | Gym profile (shown on receipts), currency, timezone, expiry alert window, change password, CSV export of all data |

### Security model (owner only)

* There is no public sign-up page. The owner account is created in the Supabase dashboard.
* Every table has an `owner_id` column and a Row Level Security policy `owner_id = auth.uid()`, so the database itself only returns the signed-in owner's rows.
* `OWNER_EMAILS` (optional) restricts which accounts can sign in to the app.
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

Each one is safe to run again. The app shows a "Database update needed" banner naming the file when a migration is missing.

### 2. Configure the app

```bash
cp .env.example .env.local
```

Fill in the values from **Project Settings → API Keys**. Only the project URL and the **publishable** key are needed; the secret key is never used:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
OWNER_EMAILS=you@yourgym.com
```

The publishable key is safe to expose. On its own it can't read any data, because Row Level Security only returns rows to the signed-in owner.

### 3. Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Sign in with the owner account, then open **Settings** to set your gym name, currency and timezone.

### Changing the owner (login) email

1. Add the new address to `OWNER_EMAILS`, keeping the old one for now (e.g. `OWNER_EMAILS=old@mail.com,new@mail.com`) in `.env.local` and in Vercel, then restart / redeploy.
2. In the app, open **Settings → Login email**, enter the new address and click the confirmation link Supabase emails you (also to the old address if "Secure email change" is on).
3. Sign in with the new email, then remove the old one from `OWNER_EMAILS`.

### Deploy (Vercel)

1. Push this repo to GitHub (already set up at `atharva-ni/Gym-manager`).
2. On [vercel.com](https://vercel.com) choose **Add New → Project**, import the repo, and add the three environment variables from `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `OWNER_EMAILS`).
3. Deploy. In Supabase → **Authentication → URL Configuration**, set the Site URL to your Vercel address.

## Tests

```bash
npm test          # billing maths + database tests (embedded Postgres, no Supabase needed)
npm run typecheck
npm run lint
```

The database tests load `schema.sql`, the seed and every migration into an embedded Postgres, and check row-level security, all-or-nothing bills, receipt numbering, freezes, refunds, day passes, plan changes and the upgrade path from the first schema version. GitHub Actions runs lint, typecheck, tests and a build on every push (`.github/workflows/ci.yml`).

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
    auth.ts           getOwner / requireOwner / getSettings
    mutations.ts      runMutation(): auth check, error mapping, revalidation
    form.ts           FormData → typed row parser
    format.ts         money, dates, timezone helpers
    billing.ts        bill splits, payment-mode allocation, plan-change credit, refunds
  components/         UI kit, form dialogs, member picker, charts, sidebar
  app/
    login/            owner sign-in
    (app)/            all authenticated pages (dashboard, members, payments, …)
    receipt/[id]/     printable receipt
    export/[table]/   CSV export route
```

## Notes

* Money totals and charts are computed in Postgres functions (`dashboard_stats`, `finance_monthly`, …) so they stay accurate regardless of row counts.
* Bills, fee collection, freezes and refunds are saved by Postgres functions (`save_bill`, `collect_fee`, `freeze_membership`, `refund_membership`) in one transaction each. Receipt numbers are assigned under a lock, so two saves at the same moment can't get the same number.
* Refunds are kept as their own records and subtracted in reports. Deleting a payment is only for mistakes.
* "Today", attendance days and hour-of-day charts use the timezone set in **Settings**.
* POS sales count as revenue alongside payments. Don't also record them as payments, or they'll be counted twice.
