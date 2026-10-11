import { daysBetween } from "@/lib/format";

export type MembershipState = "active" | "expiring" | "expired" | "frozen" | "none" | "inactive";

/** Derive a member's current standing from their latest membership. */
export function membershipState(
  m: {
    status: string;
    membership_end: string | null;
    membership_status: string | null;
    freeze_start?: string | null;
    freeze_end?: string | null;
  },
  today: string,
  alertDays: number,
): MembershipState {
  if (m.status === "inactive") return "inactive";
  if (isFrozen(m, today) || m.status === "frozen" || m.membership_status === "frozen") return "frozen";
  if (!m.membership_end) return "none";
  const left = daysBetween(today, m.membership_end);
  if (left < 0) return "expired";
  if (left <= alertDays) return "expiring";
  return "active";
}

export function daysLeftText(end: string | null, today: string) {
  if (!end) return "";
  const d = daysBetween(today, end);
  if (d < 0) return `expired ${-d}d ago`;
  if (d === 0) return "ends today";
  return `${d}d left`;
}

/** True while today falls inside the member's latest freeze. */
export function isFrozen(m: { freeze_start?: string | null; freeze_end?: string | null }, today: string) {
  return !!m.freeze_start && !!m.freeze_end && m.freeze_start <= today && today <= m.freeze_end;
}
