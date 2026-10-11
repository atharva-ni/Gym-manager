import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberOption } from "@/components/member-select";
import type { PendingFee } from "@/components/collect-fee";

/** Lightweight member list for pickers (excludes inactive accounts). */
export async function getMemberOptions(sb: SupabaseClient): Promise<MemberOption[]> {
  const { data } = await sb
    .from("members")
    .select("id, member_code, full_name, phone")
    .neq("status", "inactive")
    .order("full_name")
    .limit(5000);
  return (data ?? []) as MemberOption[];
}

/** Read `from`/`to` search params, defaulting to the current month. */
export function rangeParams(sp: Record<string, string | string[] | undefined>, today: string) {
  const valid = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = valid(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = valid(sp.to) ? sp.to : today;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Memberships and PT packages that still have money owed (optionally for one member). */
export async function getPendingFees(sb: SupabaseClient, memberId?: string): Promise<PendingFee[]> {
  let q = sb
    .from("membership_balances")
    .select("id, member_id, plan_name, kind, start_date, end_date, balance, balance_due_on")
    .neq("status", "cancelled")
    .gt("balance", 0)
    .order("start_date");
  if (memberId) q = q.eq("member_id", memberId);
  const { data } = await q.limit(1000);
  return ((data ?? []) as PendingFee[]).map((f) => ({ ...f, balance: Number(f.balance) }));
}
