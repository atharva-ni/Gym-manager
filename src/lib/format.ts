/** Indian locale: ₹1,00,000 grouping, "11 Oct 2026" dates. */
const LOCALE = "en-IN";

export function money(amount: number | string | null | undefined, currency = "INR") {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function compactMoney(amount: number, currency = "INR") {
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency, notation: "compact" }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** Format a `YYYY-MM-DD` date string without timezone shifting. */
export function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(LOCALE, {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function fmtDateTime(ts: string | null | undefined, timeZone = "Asia/Kolkata") {
  if (!ts) return "-";
  return new Date(ts).toLocaleString(LOCALE, {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone,
  });
}

export function fmtTime(ts: string | null | undefined, timeZone = "Asia/Kolkata") {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", timeZone });
}

/** `HH:MM:SS` → `6:30 AM` */
export function fmtClock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Today's date (YYYY-MM-DD) in the gym's timezone. */
export function todayISO(timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/** Local date (YYYY-MM-DD) of an instant in the gym's timezone. */
export function localDate(ts: string, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(ts));
}

/** Local hour (0-23) of an instant in the gym's timezone. */
export function localHour(ts: string, timeZone = "UTC") {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(ts)));
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000);
}

export function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: string, months: number) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

export function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(LOCALE, { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** UTC instant bounds for a local calendar day (or range of days) in `timeZone`. */
export function dayBoundsUTC(fromISO: string, timeZone = "UTC", toISO = fromISO) {
  const startOffset = tzOffsetMinutes(new Date(`${fromISO}T12:00:00Z`), timeZone);
  const endOffset = tzOffsetMinutes(new Date(`${toISO}T12:00:00Z`), timeZone);
  const start = new Date(Date.parse(`${fromISO}T00:00:00Z`) - startOffset * 60_000);
  const end = new Date(Date.parse(`${addDays(toISO, 1)}T00:00:00Z`) - endOffset * 60_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function tzOffsetMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUTC - date.getTime()) / 60_000);
}

export function age(dob: string | null, todayIso: string) {
  if (!dob) return null;
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = todayIso.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/** Open check-ins count as "inside" for this long (people forget to check out). */
export const INSIDE_HOURS = 4;

/** Earliest check-in time (ISO) that still counts as inside right now. */
export function insideSince(dayStartIso: string) {
  return new Date(Math.max(Date.parse(dayStartIso), Date.now() - INSIDE_HOURS * 3_600_000)).toISOString();
}
