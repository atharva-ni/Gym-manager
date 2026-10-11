"use server";

import { FormError } from "@/lib/form";
import { runMutation } from "@/lib/mutations";
import { dayBoundsUTC, fmtDate, money, todayISO } from "@/lib/format";
import { getSettings } from "@/lib/auth";
import type { ActionState } from "@/lib/types";

/**
 * Check a member in, refusing duplicates while they're still inside. The
 * check-in is always allowed, but the result warns the front desk when the
 * membership has expired, isn't started, is frozen, or fees are pending.
 */
export async function checkIn(memberId: string): Promise<ActionState> {
  const settings = await getSettings();
  const today = todayISO(settings.timezone);
  type Info = { full_name: string; status: string; membership_end: string | null; membership_start: string | null; balance_due: number };
  const found: { info: Info | null } = { info: null };

  const res = await runMutation(async (sb) => {
    if (!memberId) throw new FormError("Pick a member to check in");
    const { start } = dayBoundsUTC(today, settings.timezone);
    const [{ data: open }, { data: m }] = await Promise.all([
      sb.from("attendance").select("id").eq("member_id", memberId).is("check_out", null).gte("check_in", start).limit(1),
      sb
        .from("member_overview")
        .select("full_name, status, membership_start, membership_end, balance_due")
        .eq("id", memberId)
        .maybeSingle(),
    ]);
    if (open?.length) throw new FormError("This member is already checked in.");
    found.info = m as Info | null;
    return sb.from("attendance").insert({ member_id: memberId });
  });
  const m = found.info;
  if (!res?.ok || !m) return res;

  const warnings: string[] = [];
  if (!m.membership_end) warnings.push("no active membership");
  else if (m.membership_end < today) warnings.push(`membership expired on ${fmtDate(m.membership_end)}`);
  else if (m.membership_start && m.membership_start > today) warnings.push(`membership starts ${fmtDate(m.membership_start)}`);
  if (m.status === "frozen") warnings.push("membership is frozen");
  if (Number(m.balance_due) > 0) warnings.push(`${money(m.balance_due, settings.currency)} fee pending`);

  return warnings.length
    ? { ...res, message: `${m.full_name} checked in. Note: ${warnings.join(", ")}.`, tone: "warn" }
    : { ...res, message: `${m.full_name} checked in.` };
}

export async function checkInForm(_: ActionState, fd: FormData): Promise<ActionState> {
  return checkIn(String(fd.get("member_id") ?? ""));
}

export async function checkOut(id: string): Promise<ActionState> {
  const res = await runMutation((sb) => sb.from("attendance").update({ check_out: new Date().toISOString() }).eq("id", id));
  return res?.ok ? { ...res, message: "Checked out." } : res;
}
