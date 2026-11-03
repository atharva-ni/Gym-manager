/**
 * Plans with durations. A plan (e.g. "Silver") is every `plans` row with the
 * same kind and name; each row is one duration option (1 / 3 / 6 / 12 months,
 * or days for passes). No imports, so it runs in the browser, on the server
 * and in unit tests.
 */

export type PlanKindName = "membership" | "personal_training" | "pass";

export type PlanOption = {
  id: string;
  name: string;
  kind: PlanKindName;
  duration_months: number | null;
  duration_days: number;
  price: number;
  sessions: number | null;
  description: string | null;
  is_active: boolean;
};

export type PlanGroup<P extends PlanOption = PlanOption> = {
  name: string;
  kind: PlanKindName;
  description: string | null;
  /** Shortest first. */
  options: P[];
  /** At least one option is on sale. */
  active: boolean;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDaysISO(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** Same day n months later; the month's last day when that day doesn't exist (31 Jan + 1 = 28/29 Feb). */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return iso(target);
}

/** Last day of a plan bought on `start`: 15 Jan + 1 month ends 14 Feb; a 1-day pass ends the same day. */
export function planEnd(start: string, p: Pick<PlanOption, "duration_months" | "duration_days">) {
  return p.duration_months ? addDaysISO(addMonths(start, p.duration_months), -1) : addDaysISO(start, p.duration_days - 1);
}

/** "1 month", "3 months", "1 year", "1 day", "7 days". */
export function durationLabel(p: Pick<PlanOption, "duration_months" | "duration_days">) {
  const m = p.duration_months;
  if (m) return m === 12 ? "1 year" : m % 12 === 0 ? `${m / 12} years` : m === 1 ? "1 month" : `${m} months`;
  return p.duration_days === 1 ? "1 day" : `${p.duration_days} days`;
}

/** Short chip label: "1M", "3M", "1Y", "7D". */
export function durationShort(p: Pick<PlanOption, "duration_months" | "duration_days">) {
  const m = p.duration_months;
  if (m) return m % 12 === 0 ? `${m / 12}Y` : `${m}M`;
  return `${p.duration_days}D`;
}

/** Name stored on the member's plan, receipts and reports: "Silver · 3 months". */
export function planLabel(p: Pick<PlanOption, "name" | "duration_months" | "duration_days">) {
  return `${p.name} · ${durationLabel(p)}`;
}

/** Price per month of a month-based option (null for day-based ones). */
export function perMonth(p: Pick<PlanOption, "duration_months" | "price">) {
  return p.duration_months ? Math.round(Number(p.price) / p.duration_months) : null;
}

/**
 * Saving against paying month by month at the plan's 1-month price,
 * e.g. 3 months for ₹4,000 vs 3 x ₹1,500 saves 11%. Null when there's
 * no 1-month option to compare with, or no saving.
 */
export function savingPct(option: Pick<PlanOption, "duration_months" | "price">, group: Pick<PlanOption, "duration_months" | "price">[]) {
  const monthly = group.find((o) => o.duration_months === 1);
  if (!monthly || !option.duration_months || option.duration_months === 1) return null;
  const full = Number(monthly.price) * option.duration_months;
  const pct = Math.round(((full - Number(option.price)) / full) * 100);
  return pct > 0 ? pct : null;
}

const length = (p: Pick<PlanOption, "duration_months" | "duration_days">) => (p.duration_months ? p.duration_months * 31 : p.duration_days);

/** Group plan rows into plans (by kind + name), options shortest first, plans cheapest first. */
export function groupPlans<P extends PlanOption>(rows: P[]): PlanGroup<P>[] {
  const groups = new Map<string, PlanGroup<P>>();
  for (const r of rows) {
    const key = `${r.kind}\u0000${r.name}`;
    let g = groups.get(key);
    if (!g) {
      g = { name: r.name, kind: r.kind, description: r.description, options: [], active: false };
      groups.set(key, g);
    }
    g.options.push(r);
    g.active ||= r.is_active;
    g.description ||= r.description;
  }
  const list = [...groups.values()];
  for (const g of list) g.options.sort((a, b) => length(a) - length(b));
  const from = (g: PlanGroup<P>) => Math.min(...g.options.map((o) => Number(o.price) / Math.max(1, length(o))));
  return list.sort((a, b) => from(a) - from(b));
}
