"use server";

import { getSettings } from "@/lib/auth";
import { FormError, parseForm } from "@/lib/form";
import { money } from "@/lib/format";
import { runMutation } from "@/lib/mutations";
import { allocatePayments, r2, type ModeSplit } from "@/lib/billing";
import type { ActionState, MembershipBalance } from "@/lib/types";

const EPS = 0.005;

/**
 * Collect money from a member. Fee payments go to one membership / PT
 * package: the one picked, or else the member's oldest unpaid fee. An
 * optional discount / waive-off reduces what is owed, the amount can be split
 * across two payment modes, and paying more than the balance is refused.
 * Everything is saved in one transaction (collect_fee) with one receipt.
 */
export async function collectPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const { currency } = await getSettings();
  const out = { receipt: null as string | null };
  const res = await runMutation(async (sb) => {
    const f = parseForm(fd, {
      member_id: "uuid!",
      membership_id: "uuid",
      amount: "number!",
      waive: "number",
      method: "text!",
      split_payment: "bool",
      method2: "text",
      amount2: "number",
      category: "text!",
      paid_on: "date!",
      reference: "text",
      notes: "text",
      next_due_on: "date",
    });
    const amount = r2(Number(f.amount));
    const waive = r2(Number(f.waive ?? 0));
    if (amount < 0 || waive < 0) throw new FormError("Amounts can't be negative");

    let modes: ModeSplit[] = [{ method: f.method as string, amount }];
    if (f.split_payment) {
      const second = r2(Number(f.amount2 ?? 0));
      if (second <= 0 || second >= amount) throw new FormError("For a split payment, the second amount must be more than 0 and less than the total");
      if (f.method2 === f.method) throw new FormError("Choose two different payment modes for a split payment");
      modes = [
        { method: f.method as string, amount: r2(amount - second) },
        { method: (f.method2 as string) ?? "cash", amount: second },
      ];
    }
    const base = { member_id: f.member_id, paid_on: f.paid_on, reference: f.reference, notes: f.notes };

    // Not tied to a plan: admission, single PT session, misc.
    if (!f.membership_id && f.category !== "membership") {
      if (amount <= 0) throw new FormError("Amount must be more than 0");
      const rows = allocatePayments([amount], modes).map((p) => ({ ...base, amount: p.amount, method: p.method, category: f.category }));
      const { data, error } = await sb.rpc("collect_fee", { p_membership_id: null, p_waive: 0, p_waive_note: null, p_due_on: null, p_rows: rows });
      if (error) return { error };
      out.receipt = data as string | null;
      return;
    }

    let q = sb.from("membership_balances").select("*").eq("member_id", f.member_id as string).neq("status", "cancelled");
    q = f.membership_id ? q.eq("id", f.membership_id as string) : q.gt("balance", 0).order("start_date").limit(1);
    const { data, error } = await q;
    if (error) return { error };
    const ms = data?.[0] as MembershipBalance | undefined;
    if (!ms) {
      throw new FormError(
        f.membership_id
          ? "That membership doesn't belong to this member."
          : 'This member has no pending fee. Use "Renew / add plan" on their profile to start a new membership.',
      );
    }
    const balance = Number(ms.balance);
    if (waive > balance + EPS) throw new FormError(`Discount can't be more than the pending ${money(balance, currency)}.`);
    if (amount <= 0 && waive <= 0) throw new FormError("Enter an amount (or a discount to waive).");
    if (amount > balance - waive + EPS) {
      throw new FormError(
        balance > 0
          ? `Amount is more than the ${money(balance - waive, currency)} still owed for ${ms.plan_name}.`
          : `${ms.plan_name} is already fully paid.`,
      );
    }

    const remaining = balance - waive - amount;
    const rows =
      amount > 0
        ? allocatePayments([amount], modes).map((p) => ({
            ...base,
            membership_id: ms.id,
            amount: p.amount,
            method: p.method,
            category: ms.kind === "personal_training" ? "personal_training" : "membership",
          }))
        : [];
    const rpc = await sb.rpc("collect_fee", {
      p_membership_id: ms.id,
      p_waive: waive,
      p_waive_note: waive > 0 ? `Discount ${money(waive, currency)} on ${f.paid_on}${f.notes ? ` (${f.notes})` : ""}` : null,
      p_due_on: remaining > EPS ? (f.next_due_on ?? ms.balance_due_on) : null,
      p_rows: rows,
    });
    if (rpc.error) return { error: rpc.error };
    out.receipt = rpc.data as string | null;
  });
  return res?.ok && out.receipt ? { ...res, message: `Payment saved. Receipt ${out.receipt}.` } : res;
}

/** Edit a payment's details. Member and membership links stay fixed. */
export async function updatePayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const { currency } = await getSettings();
  return runMutation(async (sb) => {
    const id = String(fd.get("id") ?? "");
    const f = parseForm(fd, {
      amount: "number!",
      method: "text!",
      paid_on: "date!",
      reference: "text",
      notes: "text",
    });
    const amount = Number(f.amount);
    if (amount <= 0) throw new FormError("Amount must be more than 0");

    const { data: old, error } = await sb.from("payments").select("amount, membership_id").eq("id", id).single();
    if (error) return { error };
    if (old.membership_id) {
      const { data: ms } = await sb.from("membership_balances").select("balance, plan_name").eq("id", old.membership_id).single();
      const allowed = Number(ms?.balance ?? 0) + Number(old.amount);
      if (amount > allowed + EPS) {
        throw new FormError(`Amount can't be more than ${money(allowed, currency)} (the fee still owed for ${ms?.plan_name}).`);
      }
    }
    return sb.from("payments").update(f).eq("id", id);
  });
}
