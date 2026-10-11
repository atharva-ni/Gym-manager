"use server";

import { redirect } from "next/navigation";
import { FormError, parseForm } from "@/lib/form";
import { nextReceiptNo, runMutation, saveRow } from "@/lib/mutations";
import { addDays, money, todayISO } from "@/lib/format";
import { getSettings } from "@/lib/auth";
import type { ActionState } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const MEMBER_SPEC = {
  full_name: "text!",
  phone: "text!",
  email: "text",
  gender: "text",
  date_of_birth: "date",
  joined_on: "date!",
  trainer_id: "uuid",
  address: "text",
  emergency_name: "text",
  emergency_phone: "text",
  medical_notes: "text",
  notes: "text",
} as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Split `amount` across `weights` proportionally (2 decimals); the last share absorbs rounding. */
function split(amount: number, weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0);
  let left = r2(amount);
  return weights.map((w, i) => {
    if (i === weights.length - 1) return r2(left);
    const share = total > 0 ? r2((amount * w) / total) : 0;
    left = r2(left - share);
    return share;
  });
}

type BillCtx = { today: string; currency: string };

/**
 * Saves one bill for a member: an optional gym membership and an optional PT
 * package, a discount (₹ or %) and the amount paid now. The discount and the
 * payment are split across the items in proportion to their price, every
 * payment on the bill shares one receipt number, and anything unpaid is left
 * as a balance due by the chosen date. Mirrors components/bill-fields.tsx.
 */
async function createBill(sb: SupabaseClient, memberId: string, fd: FormData, ctx: BillCtx) {
  const f = parseForm(fd, {
    plan_id: "uuid",
    start_date: "date",
    include_admission: "bool",
    pt_plan_id: "uuid",
    trainer_id: "uuid",
    pt_start_date: "date",
    discount_value: "number",
    discount_type: "text",
    discount_reason: "text",
    amount_paid: "number",
    method: "text",
    reference: "text",
    balance_due_on: "date",
    notes: "text",
  });
  if (!f.plan_id && !f.pt_plan_id) throw new FormError("Choose a membership plan or a PT package for the bill");
  if (f.pt_plan_id && !f.trainer_id) throw new FormError("Pick the trainer for personal training");

  const ids = [f.plan_id, f.pt_plan_id].filter(Boolean) as string[];
  const { data: plans, error: planErr } = await sb
    .from("plans")
    .select("id, name, kind, sessions, duration_days, price, admission_fee")
    .in("id", ids);
  if (planErr) return { error: planErr };
  const plan = plans?.find((p) => p.id === f.plan_id);
  const pt = plans?.find((p) => p.id === f.pt_plan_id);
  if ((f.plan_id && !plan) || (f.pt_plan_id && !pt)) throw new FormError("Selected plan was not found");

  type Line = { plan: NonNullable<typeof plan>; start: string; price: number; trainer_id: string | null };
  const lines: Line[] = [];
  if (plan) {
    lines.push({
      plan,
      start: (f.start_date as string | null) ?? ctx.today,
      price: Number(plan.price) + (f.include_admission ? Number(plan.admission_fee) : 0),
      trainer_id: null,
    });
  }
  if (pt) {
    lines.push({ plan: pt, start: (f.pt_start_date as string | null) ?? ctx.today, price: Number(pt.price), trainer_id: f.trainer_id as string });
  }

  const subtotal = r2(lines.reduce((s, l) => s + l.price, 0));
  const dv = Number(f.discount_value ?? 0);
  const isPct = f.discount_type === "percent";
  if (dv < 0 || (isPct && dv > 100)) throw new FormError("Discount must be between 0 and 100%");
  const discount = Math.min(subtotal, r2(isPct ? (subtotal * dv) / 100 : dv));
  const total = r2(subtotal - discount);
  const paid = r2(Number(f.amount_paid ?? 0));
  if (paid < 0) throw new FormError("Amount paid can't be negative");
  if (paid > total + 0.005) throw new FormError(`Amount paid can't be more than the bill total (${money(total, ctx.currency)})`);

  const discounts = split(discount, lines.map((l) => l.price));
  const nets = lines.map((l, i) => r2(l.price - discounts[i]));
  const paids = split(paid, nets);
  const dueOn = (f.balance_due_on as string | null) ?? addDays(ctx.today, 7);
  const discountNote =
    discount > 0 ? `Discount ${isPct ? `${dv}%` : money(dv, ctx.currency)}${f.discount_reason ? ` (${f.discount_reason})` : ""}` : null;
  const notes = [discountNote, f.notes].filter(Boolean).join("\n") || null;

  const receiptNo = paid > 0 ? await nextReceiptNo(sb) : null;
  for (const [i, l] of lines.entries()) {
    const isPT = l.plan.kind === "personal_training";
    const { data: ms, error } = await sb
      .from("memberships")
      .insert({
        member_id: memberId,
        plan_id: l.plan.id,
        plan_name: l.plan.name,
        kind: l.plan.kind,
        trainer_id: isPT ? l.trainer_id : null,
        sessions_total: isPT ? l.plan.sessions : null,
        start_date: l.start,
        end_date: addDays(l.start, l.plan.duration_days - 1),
        price: l.price,
        discount: discounts[i],
        balance_due_on: nets[i] - paids[i] > 0.005 ? dueOn : null,
        notes,
      })
      .select("id")
      .single();
    if (error) return { error };
    if (paids[i] > 0) {
      const res = await sb.from("payments").insert({
        member_id: memberId,
        membership_id: ms.id,
        amount: paids[i],
        method: f.method ?? "upi",
        reference: f.reference,
        category: l.plan.kind,
        paid_on: ctx.today,
        receipt_no: receiptNo,
      });
      if (res.error) return { error: res.error };
    }
  }
  return { error: null, receiptNo };
}

async function billCtx(): Promise<BillCtx> {
  const s = await getSettings();
  return { today: todayISO(s.timezone), currency: s.currency };
}

export async function createMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await billCtx();
  let newId = "";
  let receipt: string | null = null;
  const res = await runMutation(async (sb) => {
    const row = parseForm(fd, MEMBER_SPEC);
    const { data, error } = await sb.from("members").insert(row).select("id").single();
    if (error) return { error };
    newId = data.id;
    const leadId = String(fd.get("lead_id") ?? "");
    if (leadId) {
      const lead = await sb.from("leads").update({ status: "converted", converted_member_id: newId }).eq("id", leadId);
      if (lead.error) return lead;
    }
    if (fd.get("plan_id") || fd.get("pt_plan_id")) {
      const bill = await createBill(sb, newId, fd, ctx);
      receipt = "receiptNo" in bill ? (bill.receiptNo ?? null) : null;
      return bill;
    }
  });
  if (res?.ok) redirect(`/members/${newId}${receipt ? `?receipt=${receipt}` : ""}`);
  // Member was created even if the bill failed, so go to the profile.
  if (newId) redirect(`/members/${newId}?warn=membership`);
  return res;
}

export async function updateMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, { ...MEMBER_SPEC, status: "text!" });
    return saveRow(sb, "members", fd.get("id"), row);
  });
}

export async function deleteMember(id: string): Promise<ActionState> {
  const res = await runMutation(async (sb) => {
    const { count } = await sb.from("payments").select("id", { count: "exact", head: true }).eq("member_id", id);
    if (count) {
      throw new FormError("This member has payment records, so they can't be deleted. Edit the member and set Status to Inactive instead.");
    }
    return sb.from("members").delete().eq("id", id);
  });
  if (res?.ok) redirect("/members");
  return res;
}

/** Renewal / new plan / PT for an existing member, as one bill. */
export async function renewMembership(memberId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await billCtx();
  let receipt: string | null = null;
  const res = await runMutation(async (sb) => {
    const bill = await createBill(sb, memberId, fd, ctx);
    receipt = "receiptNo" in bill ? (bill.receiptNo ?? null) : null;
    return bill;
  });
  return res?.ok && receipt ? { ...res, href: `/members/${memberId}?receipt=${receipt}` } : res;
}

export async function updateMembership(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      start_date: "date!",
      end_date: "date!",
      price: "number!",
      discount: "number",
      balance_due_on: "date",
      trainer_id: "uuid",
      sessions_total: "int",
      status: "text!",
      notes: "text",
    });
    row.discount ??= 0;
    // Only PT packages carry a trainer and session count
    if (fd.get("kind") !== "personal_training") {
      delete row.trainer_id;
      delete row.sessions_total;
    }
    if ((row.end_date as string) < (row.start_date as string)) throw new FormError("End date must be after start date");
    return saveRow(sb, "memberships", fd.get("id"), row);
  });
}

/** Push a membership's end date out. Used for freezes, compensation days, etc. */
export async function extendMembership(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation(async (sb) => {
    const { days } = parseForm(fd, { days: "int!" });
    const id = String(fd.get("id"));
    const { data, error } = await sb.from("memberships").select("end_date, notes").eq("id", id).single();
    if (error) return { error };
    const reason = String(fd.get("reason") ?? "").trim();
    const note = `Extended ${days}d${reason ? `: ${reason}` : ""}`;
    return sb
      .from("memberships")
      .update({
        end_date: addDays(data.end_date, Number(days)),
        notes: data.notes ? `${data.notes}\n${note}` : note,
      })
      .eq("id", id);
  });
}

/** Mark one PT session as done (or undo the last one with delta = -1). */
export async function logSession(membershipId: string, delta: 1 | -1): Promise<ActionState> {
  return runMutation(async (sb) => {
    const { data, error } = await sb
      .from("memberships")
      .select("sessions_used, sessions_total")
      .eq("id", membershipId)
      .single();
    if (error) return { error };
    const next = data.sessions_used + delta;
    if (next < 0) throw new FormError("No sessions to undo");
    if (data.sessions_total && next > data.sessions_total) throw new FormError("All sessions in this package are used");
    return sb.from("memberships").update({ sessions_used: next }).eq("id", membershipId);
  });
}

export async function saveMeasurement(memberId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      measured_on: "date!",
      weight_kg: "number",
      height_cm: "number",
      body_fat_pct: "number",
      chest_cm: "number",
      waist_cm: "number",
      arms_cm: "number",
      notes: "text",
    });
    return sb.from("measurements").insert({ ...row, member_id: memberId });
  });
}
