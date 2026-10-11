"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwner } from "@/lib/auth";
import { runMutation } from "@/lib/mutations";
import { phoneDigits } from "@/lib/billing";
import { getPendingFees } from "@/lib/queries";
import type { ActionState } from "@/lib/types";
import type { MemberOption } from "@/components/member-select";
import type { PendingFee } from "@/components/collect-fee";

const DELETABLE = new Set([
  "plans", "trainers", "members", "memberships", "payments", "attendance", "measurements",
  "classes", "expenses", "products", "sales", "equipment", "leads", "refunds",
]);

export async function deleteRecord(table: string, id: string): Promise<ActionState> {
  if (!DELETABLE.has(table)) return { error: "Not allowed" };
  return runMutation((sb) => sb.from(table).delete().eq("id", id));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Member picker search: name, member code or mobile (any format). */
export async function searchMembers(query: string): Promise<MemberOption[]> {
  if (!(await getOwner())) return [];
  const q = query.trim().replace(/[%,()*]/g, " ").trim();
  if (q.length < 2) return [];
  const sb = await createClient();
  const digits = phoneDigits(q);
  const filters = [`full_name.ilike.%${q}%`, `member_code.ilike.%${q}%`];
  if (digits.length >= 3) filters.push(`phone_digits.like.%${digits}%`);
  const { data } = await sb
    .from("members")
    .select("id, member_code, full_name, phone")
    .neq("status", "inactive")
    .or(filters.join(","))
    .order("full_name")
    .limit(12);
  return (data ?? []) as MemberOption[];
}

/** Pending fees for one member (Collect fee form). */
export async function pendingFeesFor(memberId: string): Promise<PendingFee[]> {
  if (!(await getOwner()) || !memberId) return [];
  return getPendingFees(await createClient(), memberId);
}

/** Other members already using this mobile number (duplicate warning). */
export async function membersWithPhone(phone: string, excludeId?: string): Promise<{ id: string; full_name: string; member_code: string }[]> {
  const digits = phoneDigits(phone);
  if (digits.length < 10 || !(await getOwner())) return [];
  const sb = await createClient();
  let q = sb.from("members").select("id, full_name, member_code").eq("phone_digits", digits).limit(3);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return data ?? [];
}
