// Unit tests for plan durations and grouping (runs on Node's built-in TypeScript support).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, durationLabel, groupPlans, planEnd, planLabel, savingPct, type PlanOption } from "../src/lib/plans.ts";

test("calendar months: same date next month, last day when the date doesn't exist", () => {
  assert.equal(planEnd("2026-01-15", { duration_months: 1, duration_days: 30 }), "2026-02-14");
  assert.equal(planEnd("2026-01-15", { duration_months: 3, duration_days: 90 }), "2026-04-14");
  assert.equal(planEnd("2026-01-01", { duration_months: 12, duration_days: 360 }), "2026-12-31");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
});

test("day passes use days", () => {
  assert.equal(planEnd("2026-11-02", { duration_months: null, duration_days: 1 }), "2026-11-02");
  assert.equal(planEnd("2026-11-02", { duration_months: null, duration_days: 7 }), "2026-11-08");
  assert.equal(durationLabel({ duration_months: null, duration_days: 1 }), "1 day");
});

test("labels and savings", () => {
  assert.equal(planLabel({ name: "Silver", duration_months: 3, duration_days: 90 }), "Silver · 3 months");
  assert.equal(durationLabel({ duration_months: 12, duration_days: 360 }), "1 year");
  const silver = [{ duration_months: 1, price: 1500 }, { duration_months: 3, price: 4000 }, { duration_months: 12, price: 13000 }];
  assert.equal(savingPct(silver[1], silver), 11);
  assert.equal(savingPct(silver[2], silver), 28);
  assert.equal(savingPct(silver[0], silver), null);
});

test("rows group into plans with options shortest first", () => {
  const row = (name: string, months: number, price: number): PlanOption => ({
    id: `${name}${months}`, name, kind: "membership", duration_months: months, duration_days: months * 30,
    price, sessions: null, description: null, is_active: true,
  });
  const groups = groupPlans([row("Gold", 12, 20000), row("Silver", 12, 13000), row("Silver", 1, 1500), row("Gold", 1, 2200)]);
  assert.deepEqual(groups.map((g) => [g.name, g.options.map((o) => o.duration_months)]), [["Silver", [1, 12]], ["Gold", [1, 12]]]);
});
