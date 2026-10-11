"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FormError, parseForm, type Row } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import { addDays, money, todayISO } from "@/lib/format";
import { getSettings } from "@/lib/auth";
import { allocatePayments, phoneDigits, planChangeCredit, r2, split, type ModeSplit } from "@/lib/billing";
import type { ActionState, MembershipBalance, PlanKind } from "@/lib/types";

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

type Ctx = { today: string; currency: string };

async function ctx(): Promise<Ctx> {
  const s = await getSettings();
  return { today: todayISO(s.timezone), currency: s.currency };
}

// ---------------------------------------------------------------------------
// Duplicate mobile numbers
// ---------------------------------------------------------------------------

/** Members already using this mobile number (last 10 digits), excluding `excludeId`. */
async function sameMobile(sb: SupabaseClient, phone: string | null, excludeId?: string) {
  const digits = phoneDigits(phone);
  if (digits.length < 10) return [];
  let q = sb.from("members").select("id, full_name, member_code").eq("phone_digits", digits).limit(3);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return data ?? [];
}

async function assertNoDuplicate(sb: SupabaseClient, fd: FormData, phone: string | null, excludeId?: string) {
  if (fd.get("allow_duplicate") === "on") return;
  const dups = await sameMobile(sb, phone, excludeId);
  if (dups.length) {
    const who = dups.map((d) => `${d.full_name} (${d.member_code})`).join(", ");
    throw new FormError(
      `This mobile number is already registered to ${who}. If this is a different person sharing the number (e.g. family), tick "Different person, same number" and save again.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

type PlanRow = {
  id: string;
  name: string;
  kind: PlanKind;
  sessions: number | null;
  duration_days: number;
  price: number;
  admission_fee: number;
};

type BillInput = {
  items: { plan: PlanRow; start: string; price: number; trainer_id?: string | null }[];
  discountValue: number;
  discountType: "amount" | "percent";
  discountReason?: string | null;
  /** Credit carried over from a plan being replaced (applied like a discount). */
  credit?: { amount: number; note: string };
  paid: number;
  modes: ModeSplit[];
  reference?: string | null;
  dueOn?: string | null;
  notes?: string | null;
  /** Old plan to close first (plan change). */
  close?: { id: string; end_date: string; discount: number; note: string };
};

/** Payment modes from the form: one mode, or two when "split payment" is on. */
function readModes(f: Row, paid: number): ModeSplit[] {
  const method = (f.method as string | null) ?? "upi";
  if (!f.split_payment) return [{ method, amount: paid }];
  const second = r2(Number(f.amount2 ?? 0));
  const method2 = (f.method2 as string | null) ?? "cash";
  if (second < 0 || second > paid + 0.005) throw new FormError("The second payment amount must be between 0 and the amount paid");
  if (method2 === method) throw new FormError("Choose two different payment modes for a split payment");
  return [
    { method, amount: r2(paid - second) },
    { method: method2, amount: second },
  ];
}

const PLAN_COLS = "id, name, kind, sessions, duration_days, price, admission_fee";

/** Read the bill fields posted by components/bill-fields.tsx. */
async function readBillForm(sb: SupabaseClient, fd: FormData, c: Ctx): Promise<BillInput> {
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
    split_payment: "bool",
    method2: "text",
    amount2: "number",
    reference: "text",
    balance_due_on: "date",
    notes: "text",
  });
  if (!f.plan_id && !f.pt_plan_id) throw new FormError("Choose a membership plan or a PT package for the bill");
  if (f.pt_plan_id && !f.trainer_id) throw new FormError("Pick the trainer for personal training");

  const ids = [f.plan_id, f.pt_plan_id].filter(Boolean) as string[];
  const { data: plans, error } = await sb.from("plans").select(PLAN_COLS).in("id", ids);
  if (error) throw new FormError(error.message);
  const plan = (plans as PlanRow[]).find((p) => p.id === f.plan_id);
  const pt = (plans as PlanRow[]).find((p) => p.id === f.pt_plan_id);
  if ((f.plan_id && !plan) || (f.pt_plan_id && !pt)) throw new FormError("Selected plan was not found");

  const items: BillInput["items"] = [];
  if (plan) {
    items.push({
      plan,
      start: (f.start_date as string | null) ?? c.today,
      price: Number(plan.price) + (f.include_admission ? Number(plan.admission_fee) : 0),
    });
  }
  if (pt) items.push({ plan: pt, start: (f.pt_start_date as string | null) ?? c.today, price: Number(pt.price), trainer_id: f.trainer_id as string });

  const paid = r2(Number(f.amount_paid ?? 0));
  return {
    items,
    discountValue: Number(f.discount_value ?? 0),
    discountType: f.discount_type === "percent" ? "percent" : "amount",
    discountReason: f.discount_reason as string | null,
    paid,
    modes: readModes(f, paid),
    reference: f.reference as string | null,
    dueOn: f.balance_due_on as string | null,
    notes: f.notes as string | null,
  };
}

/**
 * Validate and save a bill in one database transaction (save_bill): the
 * memberships, their payments (one receipt, any mix of payment modes) and,
 * for a plan change, closing the old plan. Mirrors components/bill-fields.tsx.
 */
async function saveBill(sb: SupabaseClient, memberId: string, b: BillInput, c: Ctx) {
  const subtotal = r2(b.items.reduce((s, l) => s + l.price, 0));
  const dv = b.discountValue;
  if (dv < 0 || (b.discountType === "percent" && dv > 100)) throw new FormError("Discount must be between 0 and 100%");
  const userDiscount = r2(b.discountType === "percent" ? (subtotal * dv) / 100 : dv);
  const credit = b.credit?.amount ?? 0;
  const discount = Math.min(subtotal, r2(userDiscount + credit));
  const total = r2(subtotal - discount);
  if (b.paid < 0) throw new FormError("Amount paid can't be negative");
  if (b.paid > total + 0.005) throw new FormError(`Amount paid can't be more than the bill total (${money(total, c.currency)})`);

  const discounts = split(discount, b.items.map((l) => l.price));
  const nets = b.items.map((l, i) => r2(l.price - discounts[i]));
  const paids = split(b.paid, nets);
  const dueOn = b.dueOn ?? addDays(c.today, 7);
  const notes =
    [
      userDiscount > 0 &&
        `Discount ${b.discountType === "percent" ? `${dv}%` : money(dv, c.currency)}${b.discountReason ? ` (${b.discountReason})` : ""}`,
      credit > 0 && b.credit?.note,
      b.notes,
    ]
      .filter(Boolean)
      .join("\n") || null;

  const lines = b.items.map((l, i) => {
    const isPT = l.plan.kind === "personal_training";
    return {
      plan_id: l.plan.id,
      plan_name: l.plan.name,
      kind: l.plan.kind,
      trainer_id: isPT ? (l.trainer_id ?? null) : null,
      sessions_total: isPT ? l.plan.sessions : null,
      start_date: l.start,
      end_date: addDays(l.start, l.plan.duration_days - 1),
      price: l.price,
      discount: discounts[i],
      balance_due_on: nets[i] - paids[i] > 0.005 ? dueOn : null,
      notes,
    };
  });
  const payments = allocatePayments(paids, b.modes).map((p) => ({
    ...p,
    category: b.items[p.line].plan.kind === "personal_training" ? "personal_training" : "membership",
    paid_on: c.today,
    reference: b.reference ?? null,
  }));

  const { data, error } = await sb.rpc("save_bill", {
    p_member_id: memberId,
    p_lines: lines,
    p_payments: payments,
    p_close: b.close ?? null,
  });
  if (error) return { error };
  return { error: null, receiptNo: (data as string | null) ?? null };
}

/** Holder so a receipt number can leave the runMutation callback. */
type Out = { receipt: string | null; id: string };

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function createMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  const out: Out = { receipt: null, id: "" };
  const res = await runMutation(async (sb) => {
    const row = parseForm(fd, MEMBER_SPEC);
    await assertNoDuplicate(sb, fd, row.phone as string);
    // Read and check the bill before creating anything
    const bill = fd.get("plan_id") || fd.get("pt_plan_id") ? await readBillForm(sb, fd, c) : null;

    const { data, error } = await sb.from("members").insert(row).select("id").single();
    if (error) return { error };
    out.id = data.id;
    const leadId = String(fd.get("lead_id") ?? "");
    if (leadId) {
      const lead = await sb.from("leads").update({ status: "converted", converted_member_id: out.id }).eq("id", leadId);
      if (lead.error) return lead;
    }
    if (bill) {
      const saved = await saveBill(sb, out.id, bill, c);
      if (saved.error) return saved;
      out.receipt = saved.receiptNo;
    }
  });
  if (res?.ok) redirect(`/members/${out.id}${out.receipt ? `?receipt=${out.receipt}` : ""}`);
  // The member was created but the bill failed: show the profile with a warning.
  if (out.id) redirect(`/members/${out.id}?warn=membership`);
  return res;
}

export async function updateMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation(async (sb) => {
    const row = parseForm(fd, { ...MEMBER_SPEC, status: "text!" });
    await assertNoDuplicate(sb, fd, row.phone as string, String(fd.get("id")));
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
  const c = await ctx();
  const out: Out = { receipt: null, id: memberId };
  const res = await runMutation(async (sb) => {
    const saved = await saveBill(sb, memberId, await readBillForm(sb, fd, c), c);
    out.receipt = saved.receiptNo ?? null;
    return saved;
  });
  return res?.ok && out.receipt ? { ...res, href: `/members/${memberId}?receipt=${out.receipt}` } : res;
}

/**
 * Change / upgrade a plan from the new plan's start date: the old plan is
 * charged only for the days used, and money paid beyond that is credited to
 * the new plan. Both happen in one transaction.
 */
export async function changePlan(membershipId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  const out: Out = { receipt: null, id: "" };
  const res = await runMutation(async (sb) => {
    const { data, error } = await sb.from("membership_balances").select("*").eq("id", membershipId).single();
    if (error) return { error };
    const old = data as MembershipBalance;
    if (old.status === "cancelled") throw new FormError("This plan is cancelled");
    out.id = old.member_id;

    const bill = await readBillForm(sb, fd, c);
    if (bill.items.length !== 1 || bill.items[0].plan.kind !== old.kind) {
      throw new FormError("Choose one new plan of the same type to change to");
    }
    const start = bill.items[0].start;
    if (start > old.end_date) throw new FormError("The new plan starts after the current one ends. Use Renew instead.");
    const cr = planChangeCredit(old, start);
    bill.credit = cr.credit > 0 ? { amount: cr.credit, note: `Credit ${money(cr.credit, c.currency)} from ${old.plan_name}` } : undefined;
    bill.close = {
      id: old.id,
      end_date: start > old.start_date ? addDays(start, -1) : old.start_date,
      discount: cr.oldDiscount,
      note: `Changed to ${bill.items[0].plan.name} from ${start}: charged ${money(cr.usedValue, c.currency)} for ${cr.usedDays} of ${cr.totalDays} days${
        cr.credit > 0 ? `, ${money(cr.credit, c.currency)} credited` : ""
      }`,
    };
    const saved = await saveBill(sb, old.member_id, bill, c);
    out.receipt = saved.receiptNo ?? null;
    return saved;
  });
  if (!res?.ok) return res;
  return {
    ...res,
    message: "Plan changed",
    href: `/members/${out.id}${out.receipt ? `?receipt=${out.receipt}` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Freeze, refunds, plan edits
// ---------------------------------------------------------------------------

/** Pause a membership: the end date moves out by the freeze length. */
export async function freezeMembership(_: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  const res = await runMutation(async (sb) => {
    const f = parseForm(fd, { id: "uuid!", start_date: "date!", days: "int!", reason: "text" });
    const days = Number(f.days);
    if (days < 1 || days > 365) throw new FormError("Freeze length must be between 1 and 365 days");
    if ((f.start_date as string) < c.today) throw new FormError("A freeze can't start in the past");
    return sb.rpc("freeze_membership", {
      p_membership_id: f.id,
      p_start: f.start_date,
      p_days: days,
      p_reason: f.reason,
    });
  });
  return res?.ok ? { ...res, message: "Membership frozen. End date moved out." } : res;
}

/** End (or cancel) a freeze; unused freeze days come back off the end date. */
export async function unfreezeMembership(freezeId: string): Promise<ActionState> {
  const c = await ctx();
  const res = await runMutation((sb) => sb.rpc("unfreeze_membership", { p_freeze_id: freezeId, p_resume: c.today }));
  return res?.ok ? { ...res, message: "Membership resumed. Unused freeze days removed." } : res;
}

/** Refund money on a plan, optionally cancelling it, in one transaction. */
export async function refundMembership(_: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  const res = await runMutation(async (sb) => {
    const f = parseForm(fd, {
      id: "uuid!",
      amount: "number",
      method: "text!",
      refunded_on: "date!",
      reason: "text",
      cancel: "bool",
    });
    const amount = r2(Number(f.amount ?? 0));
    if (amount < 0) throw new FormError("Refund can't be negative");
    if (amount === 0 && !f.cancel) throw new FormError("Enter a refund amount or tick Cancel this plan");
    if ((f.refunded_on as string) > c.today) throw new FormError("Refund date can't be in the future");
    return sb.rpc("refund_membership", {
      p_membership_id: f.id,
      p_amount: amount,
      p_method: f.method,
      p_date: f.refunded_on,
      p_reason: f.reason,
      p_cancel: !!f.cancel,
    });
  });
  return res?.ok ? { ...res, message: "Refund saved" } : res;
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

/** Push a membership's end date out (compensation days, goodwill, etc.). */
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

// ---------------------------------------------------------------------------
// Day pass / trial
// ---------------------------------------------------------------------------

/**
 * Sell a day pass or trial: finds the visitor by mobile (or creates a light
 * member record), bills the pass and optionally checks them in.
 */
export async function sellDayPass(_: ActionState, fd: FormData): Promise<ActionState> {
  const c = await ctx();
  const out = { name: "", receipt: null as string | null };
  const res = await runMutation(async (sb) => {
    const f = parseForm(fd, {
      phone: "text!",
      full_name: "text",
      plan_id: "uuid!",
      amount_paid: "number",
      method: "text",
      reference: "text",
      check_in: "bool",
    });
    const { data: plan, error: planErr } = await sb.from("plans").select(PLAN_COLS).eq("id", f.plan_id as string).single();
    if (planErr || !plan || plan.kind !== "pass") throw new FormError("Choose a day pass / trial plan");

    const existing = await sameMobile(sb, f.phone as string);
    let memberId = existing[0]?.id as string | undefined;
    out.name = existing[0]?.full_name ?? "";
    if (!memberId) {
      if (!f.full_name) throw new FormError("Enter the visitor's name");
      const ins = await sb
        .from("members")
        .insert({ full_name: f.full_name, phone: f.phone, joined_on: c.today, notes: `Came on a ${plan.name}` })
        .select("id, full_name")
        .single();
      if (ins.error) return ins;
      memberId = ins.data.id as string;
      out.name = ins.data.full_name;
    }
    const paid = r2(Number(f.amount_paid ?? plan.price));
    const saved = await saveBill(
      sb,
      memberId,
      {
        items: [{ plan: plan as PlanRow, start: c.today, price: Number(plan.price) }],
        discountValue: Math.max(0, r2(Number(plan.price) - paid)),
        discountType: "amount",
        discountReason: paid < Number(plan.price) ? "Pass price adjusted" : null,
        paid,
        modes: [{ method: (f.method as string) ?? "upi", amount: paid }],
        reference: f.reference as string | null,
        dueOn: null,
      },
      c,
    );
    if (saved.error) return saved;
    out.receipt = saved.receiptNo ?? null;
    if (f.check_in) return sb.from("attendance").insert({ member_id: memberId });
  });
  return res?.ok ? { ...res, message: `${out.name}: day pass sold${fd.get("check_in") === "on" ? " and checked in" : ""}.` } : res;
}
