// Database tests: run the real SQL in an embedded Postgres (PGlite) with a
// stand-in for Supabase's auth schema. `npm test` runs these.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const sql = (path) => readFileSync(new URL(path, root), "utf8");
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

async function freshDb(schemaPath = "supabase/schema.sql") {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
    insert into auth.users values ('${A}', 'owner@example.com', now()), ('${B}', 'other@example.com', now());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated;
    create role anon;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(sql(schemaPath));
  return db;
}

async function grant(db) {
  await db.exec(`grant usage on schema public to authenticated;
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;`);
}

/** Run a query as a signed-in owner (RLS applies). */
function as(db, uid) {
  return async (q, params) => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`);
    try {
      return (await db.query(q, params)).rows;
    } finally {
      await db.exec("reset role;");
    }
  };
}

async function setup() {
  const db = await freshDb();
  await grant(db);
  const a = as(db, A);
  const [plan] = await a(`insert into plans (name, duration_days, price, admission_fee) values ('Monthly', 30, 1500, 500) returning *`);
  const [pt] = await a(`insert into plans (name, kind, sessions, duration_days, price) values ('PT 12', 'personal_training', 12, 30, 6000) returning *`);
  const [trainer] = await a(`insert into trainers (full_name) values ('Coach') returning *`);
  const [member] = await a(`insert into members (full_name, phone) values ('Asha Rao', '+91 98765-43210') returning *`);
  return { db, a, plan, pt, trainer, member };
}

const line = (plan, extra = {}) => ({
  plan_id: plan.id, plan_name: plan.name, kind: plan.kind, start_date: "2026-10-01", end_date: "2026-10-30",
  price: Number(plan.price), discount: 0, ...extra,
});

test("schema + seed load, and owners are isolated by RLS", async () => {
  const db = await freshDb();
  await db.exec(sql("supabase/seed.sql"));
  await grant(db);
  const [{ n }] = await as(db, A)(`select count(*)::int n from members`);
  assert.ok(n >= 30);
  assert.equal((await as(db, B)(`select count(*)::int n from members`))[0].n, 0);
  assert.equal((await as(db, "")(`select count(*)::int n from payments`))[0].n, 0);
  await assert.rejects(as(db, B)(`insert into members (owner_id, full_name) values ('${A}', 'Intruder')`));
});

test("member codes are generated and mobile numbers normalised", async () => {
  const { a, member } = await setup();
  assert.equal(member.member_code, "M-0001");
  assert.equal(member.phone_digits, "9876543210");
  const [m2] = await a(`insert into members (full_name, phone) values ('B', '09876543210') returning phone_digits`);
  assert.equal(m2.phone_digits, "9876543210", "leading 0 / +91 forms match for duplicate checks");
});

test("save_bill saves membership + PT with one shared receipt", async () => {
  const { a, plan, pt, trainer, member } = await setup();
  const lines = [line(plan, { price: 2000 }), line(pt, { trainer_id: trainer.id, sessions_total: 12, discount: 600 })];
  const pays = [
    { line: 0, amount: 2000, method: "cash", category: "membership", paid_on: "2026-10-01" },
    { line: 1, amount: 3000, method: "upi", category: "personal_training", paid_on: "2026-10-01" },
  ];
  const [{ r }] = await a(`select save_bill($1, $2, $3) r`, [member.id, JSON.stringify(lines), JSON.stringify(pays)]);
  assert.equal(r, "R-00001");
  const rows = await a(`select receipt_no, method from payments order by amount`);
  assert.deepEqual(rows.map((x) => x.receipt_no), ["R-00001", "R-00001"]);
  const bal = await a(`select kind, balance::float from membership_balances order by kind`);
  assert.deepEqual(bal, [{ kind: "membership", balance: 0 }, { kind: "personal_training", balance: 2400 }]);
  const [{ r: next }] = await a(`select save_bill($1, $2, $3) r`, [member.id, JSON.stringify([line(plan)]), JSON.stringify([{ line: 0, amount: 100, method: "cash" }])]);
  assert.equal(next, "R-00002", "receipt numbers continue");
});

test("save_bill is all-or-nothing", async () => {
  const { a, plan, member } = await setup();
  const bad = [line(plan), line(plan, { kind: "bogus" })];
  await assert.rejects(a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify(bad)]));
  assert.equal((await a(`select count(*)::int n from memberships`))[0].n, 0, "first line rolled back");
});

test("collect_fee applies waive-off, due date and payment together", async () => {
  const { a, plan, member } = await setup();
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify([line(plan)])]);
  const [ms] = await a(`select id from memberships`);
  await a(`select collect_fee($1, 200, 'Waived', '2026-10-20', $2)`, [
    ms.id, JSON.stringify([{ member_id: member.id, membership_id: ms.id, amount: 800, method: "upi", category: "membership", paid_on: "2026-10-05" }]),
  ]);
  const [b] = await a(`select balance::float, discount::float, balance_due_on::text from membership_balances`);
  assert.deepEqual(b, { balance: 500, discount: 200, balance_due_on: "2026-10-20" });
});

test("freeze pushes the end date out and early unfreeze takes unused days back", async () => {
  const { a, plan, member } = await setup();
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify([line(plan)])]);
  const [ms] = await a(`select id from memberships`);
  await a(`select freeze_membership($1, '2026-10-10', 10, 'Travel')`, [ms.id]);
  assert.equal((await a(`select end_date::text e from memberships`))[0].e, "2026-11-09");
  await assert.rejects(a(`select freeze_membership($1, '2026-10-15', 3, null)`, [ms.id]), /already has a freeze/);
  const [ov] = await a(`select freeze_start::text, freeze_end::text from member_overview`);
  assert.deepEqual(ov, { freeze_start: "2026-10-10", freeze_end: "2026-10-19" });
  const [f] = await a(`select id from membership_freezes`);
  await a(`select unfreeze_membership($1, '2026-10-14')`, [f.id]); // 6 unused days
  assert.equal((await a(`select end_date::text e from memberships`))[0].e, "2026-11-03");
  assert.deepEqual(await a(`select end_date::text, days from membership_freezes`), [{ end_date: "2026-10-13", days: 4 }]);
});

test("refunds lower paid, cancel removes dues, and reports subtract refunds", async () => {
  const { a, plan, member } = await setup();
  await a(`select save_bill($1, $2, $3)`, [member.id, JSON.stringify([line(plan, { price: 1500 })]),
    JSON.stringify([{ line: 0, amount: 1000, method: "cash", paid_on: "2026-10-01" }])]);
  const [ms] = await a(`select id from memberships`);
  await assert.rejects(a(`select refund_membership($1, 1200, 'cash', '2026-10-05', null, false)`, [ms.id]), /more than/);
  await a(`select refund_membership($1, 400, 'upi', '2026-10-05', 'Moving city', true)`, [ms.id]);
  const [b] = await a(`select paid::float, refunded::float, status from membership_balances`);
  assert.deepEqual(b, { paid: 600, refunded: 400, status: "cancelled" });
  const [s] = await a(`select dashboard_stats('2026-10-05', 7, '2026-10-05', '2026-10-06') s`);
  assert.equal(Number(s.s.dues_total), 0, "cancelled plans have no dues");
  assert.equal(Number(s.s.revenue_month), 600);
  assert.equal(Number(s.s.refunds_month), 400);
  const [fin] = await a(`select payments::float from finance_monthly('2026-10-01', '2026-10-31')`);
  assert.equal(fin.payments, 600);
});

test("day passes are not counted as members", async () => {
  const { a, member } = await setup();
  const [pass] = await a(`insert into plans (name, kind, duration_days, price) values ('Day pass', 'pass', 1, 200) returning *`);
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify([line(pass, { start_date: "2026-10-05", end_date: "2026-10-05" })])]);
  const [s] = await a(`select dashboard_stats('2026-10-05', 7, '2026-10-05', '2026-10-06') s`);
  assert.equal(s.s.active_members, 0);
  assert.equal(s.s.passes_today, 1);
  assert.equal((await a(`select membership_kind from member_overview`))[0].membership_kind, "pass");
});

test("upgrading an existing database: v1 -> 002 ... 007 (re-runnable)", async () => {
  const db = await freshDb("tests/fixtures/schema_v1.sql");
  await db.exec(`
    insert into public.plans (owner_id, name, duration_days, price) values ('${A}', 'Old Monthly', 30, 1500);
    insert into public.members (owner_id, full_name, phone) values ('${A}', 'Old Member', '98765 43210');
    insert into public.memberships (owner_id, member_id, plan_name, start_date, end_date, price)
      select '${A}', id, 'Old Monthly', current_date, current_date + 29, 1500 from public.members;
    insert into public.payments (owner_id, member_id, membership_id, amount)
      select '${A}', member_id, id, 1000 from public.memberships;
  `);
  for (const m of ["002_payments_and_pt", "003_receipts", "004_freeze_refunds_passes", "005_unfreeze_status", "006_operations", "007_performance_optimization"]) {
    await db.exec(sql(`supabase/migrations/${m}.sql`));
    await db.exec(sql(`supabase/migrations/${m}.sql`)); // safe to run twice
  }
  await grant(db);
  const a = as(db, A);
  const [m] = await a(`select phone_digits, balance_due::float, membership_kind from member_overview`);
  assert.deepEqual(m, { phone_digits: "9876543210", balance_due: 500, membership_kind: "membership" });
  assert.equal((await a(`select receipt_no from payments`))[0].receipt_no, "R-00001");
  const [{ r }] = await a(`select record_payments($1) r`, [JSON.stringify([{ member_id: (await a(`select id from members`))[0].id, amount: 100, method: "cash" }])]);
  assert.equal(r, "R-00002");
  // The fresh schema also accepts the seed after migrations
  await db.exec(sql("supabase/seed.sql"));
});

test("plan change closes the old plan and credits unused days in one transaction", async () => {
  const { a, plan, member } = await setup();
  const [annual] = await a(`insert into plans (name, duration_days, price) values ('Annual', 365, 13000) returning *`);
  await a(`select save_bill($1, $2, $3)`, [member.id, JSON.stringify([line(plan, { price: 3000 })]),
    JSON.stringify([{ line: 0, amount: 3000, method: "upi", paid_on: "2026-10-01" }])]);
  const [old] = await a(`select id from memberships`);
  // Change on 11 Oct: 10 of 30 days used (₹1,000), ₹2,000 credited
  const close = { id: old.id, end_date: "2026-10-10", discount: 2000, note: "Changed to Annual" };
  const next = [line(annual, { start_date: "2026-10-11", end_date: "2027-10-10", price: 13000, discount: 2000 })];
  await a(`select save_bill($1, $2, $3, $4)`, [member.id, JSON.stringify(next),
    JSON.stringify([{ line: 0, amount: 5000, method: "cash", paid_on: "2026-10-11" }]), JSON.stringify(close)]);
  const rows = await a(`select plan_name, end_date::text, balance::float from membership_balances order by start_date`);
  assert.deepEqual(rows, [
    { plan_name: "Monthly", end_date: "2026-10-10", balance: 0 },
    { plan_name: "Annual", end_date: "2027-10-10", balance: 6000 },
  ]);
  // A bad close target rolls everything back
  await assert.rejects(a(`select save_bill($1, $2, '[]'::jsonb, $3)`, [member.id, JSON.stringify(next),
    JSON.stringify({ ...close, id: "00000000-0000-0000-0000-000000000000" })]), /not found/);
  assert.equal((await a(`select count(*)::int n from memberships`))[0].n, 2);
});

test("unfreezing clears old manual frozen statuses too", async () => {
  const { a, plan, member } = await setup();
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify([line(plan)])]);
  const [ms] = await a(`select id from memberships`);
  // Old-style: member and plan marked frozen by hand, plus a dated freeze
  await a(`update members set status = 'frozen'`);
  await a(`update memberships set status = 'frozen'`);
  await a(`select freeze_membership($1, '2026-10-10', 5, null)`, [ms.id]);
  const [f] = await a(`select id from membership_freezes`);
  await a(`select unfreeze_membership($1, '2026-10-12')`, [f.id]);
  assert.deepEqual(await a(`select status from members`), [{ status: "active" }]);
  assert.deepEqual(await a(`select status from memberships`), [{ status: "active" }]);
  // Frozen only by hand (no dates): clear_frozen_status fixes it
  await a(`update members set status = 'frozen'`);
  await a(`select clear_frozen_status($1)`, [member.id]);
  assert.deepEqual(await a(`select status from members`), [{ status: "active" }]);
});


test("dashboard counts are consistent: passes excluded, renewals include PT", async () => {
  const { a, plan, pt, trainer, member } = await setup();
  const [pass] = await a(`insert into plans (name, kind, duration_days, price) values ('Day pass', 'pass', 1, 200) returning *`);
  const [visitor] = await a(`insert into members (full_name, phone) values ('Visitor', '9000000001') returning *`);
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [visitor.id, JSON.stringify([line(pass, { start_date: "2026-10-05", end_date: "2026-10-05" })])]);
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify([
    line(plan, { start_date: "2026-09-08", end_date: "2026-10-07" }),
    line(pt, { trainer_id: trainer.id, start_date: "2026-09-08", end_date: "2026-10-07" }),
  ])]);
  const [{ s }] = await a(`select dashboard_stats('2026-10-05', 7, '2026-10-05', '2026-10-06') s`);
  assert.equal(s.total_members, 1, "day-pass visitor not counted");
  assert.equal(s.expiring, 1);
  assert.equal(s.renewals_due, 2, "gym + PT ending soon");
});

test("refund without cancelling lowers the fee, refunds are numbered, deleting a payment reopens a due date", async () => {
  const { a, plan, member } = await setup();
  await a(`select save_bill($1, $2, $3)`, [member.id, JSON.stringify([line(plan, { price: 1500 })]),
    JSON.stringify([{ line: 0, amount: 1500, method: "cash", paid_on: "2026-10-01" }])]);
  const [ms] = await a(`select id from memberships`);
  await a(`select refund_membership($1, 300, 'upi', '2026-10-03', 'Goodwill', false)`, [ms.id]);
  const [b] = await a(`select balance::float, discount::float, status from membership_balances`);
  assert.deepEqual(b, { balance: 0, discount: 300, status: "active" }, "no balance reappears");
  assert.equal((await a(`select refund_no from refunds`))[0].refund_no, "RF-00001");
  const [pay] = await a(`select id from payments`);
  await a(`delete from payments where id = $1`, [pay.id]);
  const [m2] = await a(`select balance::float, balance_due_on from membership_balances`);
  assert.ok(m2.balance > 0 && m2.balance_due_on, "balance reopened with a due date");
});

test("PT sessions are logged with date and trainer, and can be undone", async () => {
  const { a, pt, trainer, member } = await setup();
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify([line(pt, { trainer_id: trainer.id, sessions_total: 2 })])]);
  const [ms] = await a(`select id from memberships`);
  await a(`select log_pt_session($1, '2026-10-02', 'Legs')`, [ms.id]);
  await a(`select log_pt_session($1, '2026-10-04', null)`, [ms.id]);
  await assert.rejects(a(`select log_pt_session($1, '2026-10-06', null)`, [ms.id]), /All sessions/);
  assert.deepEqual(await a(`select session_date::text d, trainer_id = $1 t from pt_sessions order by session_date`, [trainer.id]),
    [{ d: "2026-10-02", t: true }, { d: "2026-10-04", t: true }]);
  await a(`select undo_pt_session($1)`, [ms.id]);
  assert.equal((await a(`select sessions_used from memberships`))[0].sessions_used, 1);
  const [st] = await a(`select sessions from trainer_pt_stats('2026-10-01', '2026-10-31', '2026-10-05') where trainer_id = $1`, [trainer.id]);
  assert.equal(Number(st.sessions), 1);
});

test("counter sales get receipts; credit sales go to dues and count as revenue when paid", async () => {
  const { a, member } = await setup();
  const [prod] = await a(`insert into products (name, price, cost, stock) values ('Whey', 2500, 1800, 5) returning *`);
  const [{ n: s1 }] = await a(`select pos_sale($1, 1, 2500, null, 'upi', '2026-10-05', false, null) n`, [prod.id]);
  assert.equal(s1, "S-00001");
  const [{ n: s2 }] = await a(`select pos_sale($1, 2, 2500, $2, null, '2026-10-05', true, '2026-10-12') n`, [prod.id, member.id]);
  assert.equal(s2, "S-00002");
  assert.equal((await a(`select stock from products`))[0].stock, 2);
  const [due] = await a(`select kind, balance::float from membership_balances`);
  assert.deepEqual(due, { kind: "charge", balance: 5000 });
  const [{ s }] = await a(`select dashboard_stats('2026-10-05', 7, '2026-10-05', '2026-10-06') s`);
  assert.equal(Number(s.revenue_today), 2500, "credit sale not counted until paid");
  await assert.rejects(a(`select pos_sale($1, 9, 2500, null, 'cash', '2026-10-05', false, null)`, [prod.id]), /in stock/);
  // Voiding the unpaid credit sale removes its due and returns stock
  const [sale] = await a(`select id from sales where on_credit`);
  await a(`delete from sales where id = $1`, [sale.id]);
  assert.equal((await a(`select count(*)::int n from memberships`))[0].n, 0);
  assert.equal((await a(`select stock from products`))[0].stock, 4);
});

test("freeze rules: max days per plan and a freeze fee added to dues", async () => {
  const { a, plan, member } = await setup();
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify([line(plan, { price: 1500 })])]);
  const [ms] = await a(`select id from memberships`);
  await a(`select freeze_membership($1, '2026-10-05', 10, null, 15, 200)`, [ms.id]);
  await assert.rejects(a(`select freeze_membership($1, '2026-10-20', 10, null, 15, 0)`, [ms.id]), /limit is 15/);
  const fee = await a(`select plan_name, kind, balance::float from membership_balances where kind = 'charge'`);
  assert.deepEqual(fee, [{ plan_name: "Freeze fee", kind: "charge", balance: 200 }]);
});

test("transfer moves a membership to another member with an optional fee", async () => {
  const { a, plan, member } = await setup();
  const [other] = await a(`insert into members (full_name, phone) values ('Ravi', '9000000002') returning *`);
  await a(`select save_bill($1, $2, '[]'::jsonb)`, [member.id, JSON.stringify([line(plan)])]);
  const [ms] = await a(`select id from memberships`);
  await a(`select transfer_membership($1, $2, 500, 'Moving away', '2026-10-05')`, [ms.id, other.id]);
  const rows = await a(`select kind, member_id = $1 mine from memberships order by kind`, [other.id]);
  assert.deepEqual(rows, [{ kind: "charge", mine: true }, { kind: "membership", mine: true }]);
  await assert.rejects(a(`select transfer_membership($1, $2, 0, null, null)`, [ms.id, other.id]), /different member/);
});

test("equipment service history, recurring expenses and class bookings", async () => {
  const { a, member } = await setup();
  const [eq] = await a(`insert into equipment (name, status) values ('Treadmill', 'needs_service') returning *`);
  await a(`select log_equipment_service($1, '2026-10-05', '2027-01-05', 1200, 'Belt')`, [eq.id]);
  assert.deepEqual(await a(`select status, last_service::text from equipment`), [{ status: "working", last_service: "2026-10-05" }]);
  assert.equal((await a(`select count(*)::int n from equipment_services where expense_id is not null`))[0].n, 1);

  await a(`insert into recurring_expenses (category, amount, day_of_month, description) values ('rent', 15000, 1, 'Rent'), ('utilities', 4000, 20, 'Power')`);
  assert.equal((await a(`select post_recurring_expenses('2026-10-05') n`))[0].n, 1, "only rent is due by the 5th");
  assert.equal((await a(`select post_recurring_expenses('2026-10-06') n`))[0].n, 0, "not added twice");
  assert.equal((await a(`select post_recurring_expenses('2026-10-25') n`))[0].n, 1, "power on the 20th");

  const [cls] = await a(`insert into classes (name, day_of_week, start_time, end_time, capacity) values ('Yoga', 1, '07:00', '08:00', 1) returning *`);
  const [m2] = await a(`insert into members (full_name, phone) values ('B', '9000000003') returning *`);
  await a(`select book_class($1, $2, '2026-10-05')`, [cls.id, member.id]); // 5 Oct 2026 is a Monday
  await assert.rejects(a(`select book_class($1, $2, '2026-10-05')`, [cls.id, m2.id]), /full/);
  await assert.rejects(a(`select book_class($1, $2, '2026-10-06')`, [cls.id, m2.id]), /does not run/);
});

test("shared receipt links work without login and reveal nothing else", async () => {
  const { db, a, plan, member } = await setup();
  await a(`select save_bill($1, $2, $3)`, [member.id, JSON.stringify([line(plan, { price: 1500 })]),
    JSON.stringify([{ line: 0, amount: 1000, method: "upi", paid_on: "2026-10-01" }])]);
  const [{ share_token }] = await a(`select share_token from payments`);
  await db.exec(`grant usage on schema public to anon;`);
  const run = async (q, p) => {
    await db.exec(`set role anon;`);
    try {
      return (await db.query(q, p)).rows;
    } finally {
      await db.exec("reset role;");
    }
  };
  const [{ r }] = await run(`select public_receipt($1) r`, [share_token]);
  assert.equal(r.receipt_no, "R-00001");
  assert.equal(r.member.full_name, "Asha Rao");
  assert.equal(Number(r.balance), 500);
  const [{ r: none }] = await run(`select public_receipt(gen_random_uuid()) r`);
  assert.equal(none, null);
  await assert.rejects(run(`select * from payments`), "anon can't read tables directly");
});
