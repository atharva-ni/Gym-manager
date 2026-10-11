/**
 * Pure billing maths shared by the server actions and the bill forms.
 * No imports, so it runs in the browser, on the server and in unit tests.
 */

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Split `amount` across `weights` proportionally (2 decimals); the last share absorbs rounding. */
export function split(amount: number, weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0);
  let left = r2(amount);
  return weights.map((w, i) => {
    if (i === weights.length - 1) return r2(left);
    const share = total > 0 ? r2((amount * w) / total) : 0;
    left = r2(left - share);
    return share;
  });
}

export type ModeSplit = { method: string; amount: number };

/**
 * Turn "how much each bill line gets" plus "how the customer paid"
 * (e.g. ₹2,000 cash + ₹3,000 UPI) into payment rows. Modes are used in
 * order and a line can be paid by more than one mode.
 */
export function allocatePayments(linePaid: number[], modes: ModeSplit[]) {
  const buckets = modes.filter((m) => m.amount > 0).map((m) => ({ ...m, left: r2(m.amount) }));
  const rows: { line: number; method: string; amount: number }[] = [];
  let b = 0;
  linePaid.forEach((due, line) => {
    let need = r2(due);
    while (need > 0.004 && b < buckets.length) {
      const take = r2(Math.min(need, buckets[b].left));
      if (take > 0) rows.push({ line, method: buckets[b].method, amount: take });
      need = r2(need - take);
      buckets[b].left = r2(buckets[b].left - take);
      if (buckets[b].left <= 0.004) b++;
    }
  });
  return rows;
}

const dayNo = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** Days from `from` to `to`, counting both ends (1 Oct to 30 Oct = 30). */
export const daysInclusive = (from: string, to: string) => dayNo(to) - dayNo(from) + 1;

type Fee = { price: number; discount: number; paid: number; start_date: string; end_date: string };

/**
 * Changing / upgrading a plan on `changeDate`: the old plan is charged only for
 * the days used, and whatever was paid beyond that becomes credit on the new plan.
 */
export function planChangeCredit(fee: Fee, changeDate: string) {
  const net = Number(fee.price) - Number(fee.discount);
  const total = Math.max(1, daysInclusive(fee.start_date, fee.end_date));
  const used = Math.min(total, Math.max(0, dayNo(changeDate) - dayNo(fee.start_date)));
  const usedValue = r2((net * used) / total);
  const credit = Math.max(0, r2(Number(fee.paid) - usedValue));
  return {
    usedDays: used,
    totalDays: total,
    usedValue,
    credit,
    /** Discount that makes the old plan's fee equal to the value used. */
    oldDiscount: r2(Number(fee.price) - usedValue),
  };
}

/** Suggested refund when cancelling on `date`: the paid share of the unused days. */
export function refundSuggestion(fee: Fee, date: string) {
  const net = Number(fee.price) - Number(fee.discount);
  const total = Math.max(1, daysInclusive(fee.start_date, fee.end_date));
  const remaining = Math.min(total, Math.max(0, dayNo(fee.end_date) - dayNo(date) + 1));
  const unusedValue = r2((net * remaining) / total);
  return Math.max(0, Math.min(Number(fee.paid), unusedValue));
}

/** Last 10 digits of a mobile number, for duplicate checks (matches members.phone_digits). */
export const phoneDigits = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-10);
