# SetFit Fitness: Gym Manager

An owner-only gym management system built with **Next.js 16** (App Router, Server Actions) and **Supabase** (Postgres + Auth + Row Level Security).

## Features

| Area | What you get |
| --- | --- |
| **Dashboard** | Active members, today's check-ins and who's inside, month revenue & net profit, alerts for expiring/expired plans, outstanding dues, lead follow-ups, low stock and equipment faults, 6-month revenue vs expenses chart, today's classes, birthdays |
| **Members** | Searchable, filterable list (active / expiring / expired / with dues / frozen / inactive), auto member codes (`M-0001`), full profile with emergency contact and medical notes, assigned trainer |
| **Memberships** | Sell or renew plans with discounts and admission fees, partial payments with running balance, extend (freeze/holiday) and edit, full history |
| **Admission & billing** | One "New admission" screen: member basics (more details optional), gym plan and/or PT package with trainer, discount in ₹ or % with a reason, paid now (full, half, part or nothing) and balance due date, with a live bill summary. Renew / add plan and Add PT use the same bill. Sequential receipt numbers (R-00001), one receipt per bill. |
| **Fees & payments** | Every payment belongs to a member and is applied to their membership or PT fee. Pending dues list with one-click collect, discount / waive-off on a balance, WhatsApp reminders, overpayment blocked, receipts showing fee, paid and balance |
| **Personal training** | PT packages (e.g. 12 sessions / 30 days) sold with a trainer, session tracking, PT dues, trainer PT clients, PT revenue and commission added to salary payouts |
| **Attendance** | Quick check-in with member search, check-out, day-by-day log, busiest hours chart |
| **Progress** | Body measurements, BMI and weight trend per member |
| **Plans** | Membership packages with duration, price, admission fee and active-member counts |
| **Staff** | Trainers & employees, assigned members/classes, payroll total, one-click salary payout (booked as an expense) |
| **Classes** | Weekly timetable with trainer, room and capacity |
| **Expenses** | Categorised spending with breakdown chart |
| **Inventory & POS** | Products with stock, cost and margin, low-stock alerts, restock (optionally booked as an expense), front-desk sales that decrement stock automatically |
| **Equipment** | Asset register, condition, service schedule, service log (cost booked as maintenance expense) |
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

If you ran `schema.sql` before an update, run the new files in [`supabase/migrations`](supabase/migrations) once, in order, in the SQL Editor. The app shows a "Database update needed" banner when a migration is missing.

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

### Deploy

Deploy to Vercel (or any Node host): set the same three environment variables and run `npm run build`.

## Project structure

```
supabase/
  schema.sql          tables, triggers, views, RLS policies, reporting functions
  seed.sql            optional demo data
src/
  proxy.ts            session refresh + auth redirect (Next 16 "proxy", formerly middleware)
  lib/
    supabase/         server + proxy Supabase clients
    auth.ts           getOwner / requireOwner / getSettings
    mutations.ts      runMutation(): auth check, error mapping, revalidation
    form.ts           FormData → typed row parser
    format.ts         money, dates, timezone helpers
  components/         UI kit, form dialogs, member picker, charts, sidebar
  app/
    login/            owner sign-in
    (app)/            all authenticated pages (dashboard, members, payments, …)
    receipt/[id]/     printable receipt
    export/[table]/   CSV export route
```

## Notes

* Money totals and charts are computed in Postgres functions (`dashboard_stats`, `finance_monthly`, …) so they stay accurate regardless of row counts.
* "Today", attendance days and hour-of-day charts use the timezone set in **Settings**.
* POS sales count as revenue alongside payments. Don't also record them as payments, or they'll be counted twice.
