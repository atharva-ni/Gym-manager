"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth";
import { runMutation } from "@/lib/mutations";
import { photoUrls, removeFiles } from "@/lib/photos";
import { phoneDigits } from "@/lib/billing";
import { getPendingFees } from "@/lib/queries";
import type { ActionState } from "@/lib/types";
import type { MemberOption } from "@/components/member-select";
import type { PendingFee } from "@/components/collect-fee";

// Payments, refunds and sales are voided with a reason instead (voidRecord).
// Members go through deleteMember, which also removes their photo.
const DELETABLE = new Set([
  "plans", "trainers", "memberships", "attendance", "measurements",
  "classes", "expenses", "products", "equipment", "leads", "recurring_expenses",
]);

/** Owner only. Expenses take their bill photo with them. */
export async function deleteRecord(table: string, id: string): Promise<ActionState> {
  if (!DELETABLE.has(table)) return { error: "Not allowed" };
  if ((await getAccess())?.role !== "owner") return { error: "Only the gym owner can delete records." };
  return runMutation(async (sb) => {
    if (table !== "expenses") return sb.from(table).delete().eq("id", id);
    const { data, error } = await sb.from("expenses").delete().eq("id", id).select("bill_path");
    if (error) return { error };
    await removeFiles(sb, "bills", data.map((e) => e.bill_path));
  });
}

/** Void a payment, refund or sale with a reason (owner only, kept in the activity log). */
export async function voidRecord(table: "payments" | "refunds" | "sales", id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Write why this is being voided." };
  return runMutation((sb) => sb.rpc("void_record", { p_table: table, p_id: id, p_reason: reason }));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Member picker search: name, member code or mobile (any format). */
export async function searchMembers(query: string): Promise<MemberOption[]> {
  if (!(await getAccess())) return [];
  const q = query.trim().replace(/[%,()*]/g, " ").trim();
  if (q.length < 2) return [];
  const sb = await createClient();
  const digits = phoneDigits(q);
  const filters = [`full_name.ilike.%${q}%`, `member_code.ilike.%${q}%`];
  if (digits.length >= 3) filters.push(`phone_digits.like.%${digits}%`);
  const { data } = await sb
    .from("members")
    .select("id, member_code, full_name, phone, photo_path")
    .neq("status", "inactive")
    .or(filters.join(","))
    .order("full_name")
    .limit(12);
  const rows = data ?? [];
  const photos = await photoUrls(sb, rows.map((m) => m.photo_path));
  return rows.map(({ photo_path, ...m }) => ({ ...m, photo_url: photo_path ? (photos.get(photo_path) ?? null) : null }));
}

/** Pending fees for one member (Collect fee form). */
export async function pendingFeesFor(memberId: string): Promise<PendingFee[]> {
  if (!(await getAccess()) || !memberId) return [];
  return getPendingFees(await createClient(), memberId);
}

/** Other members already using this mobile number (duplicate warning). */
export async function membersWithPhone(phone: string, excludeId?: string): Promise<{ id: string; full_name: string; member_code: string }[]> {
  const digits = phoneDigits(phone);
  if (digits.length < 10 || !(await getAccess())) return [];
  const sb = await createClient();
  let q = sb.from("members").select("id, full_name, member_code").eq("phone_digits", digits).limit(3);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return data ?? [];
}
