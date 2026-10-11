// Unit tests for the billing maths (runs on Node's built-in TypeScript support).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocatePayments, daysInclusive, phoneDigits, planChangeCredit, refundSuggestion, split } from "../src/lib/billing.ts";

test("split keeps the total exact", () => {
  assert.deepEqual(split(800, [2000, 6000]), [200, 600]);
  const parts = split(100, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100);
});

test("allocatePayments fills lines in order across payment modes", () => {
  // Gym ₹2,000 + PT ₹3,000 paid as ₹1,500 cash + ₹3,500 UPI
  assert.deepEqual(allocatePayments([2000, 3000], [{ method: "cash", amount: 1500 }, { method: "upi", amount: 3500 }]), [
    { line: 0, method: "cash", amount: 1500 },
    { line: 0, method: "upi", amount: 500 },
    { line: 1, method: "upi", amount: 3000 },
  ]);
  assert.deepEqual(allocatePayments([1000], [{ method: "upi", amount: 1000 }, { method: "cash", amount: 0 }]), [
    { line: 0, method: "upi", amount: 1000 },
  ]);
});

test("daysInclusive counts both ends", () => {
  assert.equal(daysInclusive("2026-10-01", "2026-10-30"), 30);
  assert.equal(daysInclusive("2026-10-05", "2026-10-05"), 1);
});

test("planChangeCredit charges used days and credits the rest", () => {
  const fee = { price: 3000, discount: 0, paid: 3000, start_date: "2026-10-01", end_date: "2026-10-30" };
  const c = planChangeCredit(fee, "2026-10-11"); // 10 of 30 days used
  assert.equal(c.usedValue, 1000);
  assert.equal(c.credit, 2000);
  assert.equal(c.oldDiscount, 2000);
  // Only part paid: credit is what was paid beyond the used value
  assert.equal(planChangeCredit({ ...fee, paid: 500 }, "2026-10-11").credit, 0);
  // Changing before the plan starts credits everything paid
  assert.equal(planChangeCredit(fee, "2026-09-25").credit, 3000);
});

test("refundSuggestion refunds the paid share of unused days", () => {
  const fee = { price: 3000, discount: 0, paid: 3000, start_date: "2026-10-01", end_date: "2026-10-30" };
  assert.equal(refundSuggestion(fee, "2026-10-21"), 1000); // 10 days left
  assert.equal(refundSuggestion({ ...fee, paid: 500 }, "2026-10-21"), 500);
  assert.equal(refundSuggestion(fee, "2026-11-05"), 0);
});

test("phoneDigits normalises Indian mobile formats", () => {
  for (const p of ["+91 98765 43210", "098765-43210", "9876543210"]) assert.equal(phoneDigits(p), "9876543210");
});
