"use server";

import { getSettings } from "@/lib/auth";
import { FormError, parseForm } from "@/lib/form";
import { money } from "@/lib/format";
import { nextReceiptNo, runMutation } from "@/lib/mutations";
import type { ActionState, MembershipBalance } from "@/lib/types";

const EPS = 0.005;

/**
 * Collect money from a member. Fee payments are applied to one membership or
 * PT package: the one picked in the form, or else the member's oldest unpaid
 * fee. An optional discount / waive-off reduces what is owed. Paying more
 * than the pending balance is refused. Payments without a fee (admission,
 * single PT session, misc.) are still tied to the member.
 */
export async function collectPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const { currency } = await getSettings();
  return runMutation(async (sb) => {
    const f = parseForm(fd, {
      member_id: "uuid!",
      membership_id: "uuid",
      amount: "number!",
      waive: "number",
      method: "text!",
      category: "text!",
      paid_on: "date!",
      reference: "text",
      notes: "text",
      next_due_on: "date",
    });
    const amount = Number(f.amount);
    const waive = Number(f.waive ?? 0);
    if (amount < 0 || waive < 0) throw new FormError("Amounts can't be negative");

    if (!f.membership_id && f.category !== "membership") {
      if (amount <= 0) throw new FormError("Amount must be more than 0");
      const receipt_no = await nextReceiptNo(sb);
      return sb.from("payments").insert({ ...pick(f), membership_id: null, receipt_no });
    }

    let q = sb
      .from("membership_balances")
      .select("*")
      .eq("member_id", f.member_id as string)
      .neq("status", "cancelled");
    q = f.membership_id ? q.eq("id", f.membership_id as string) : q.gt("balance", 0).order("start_date").limit(1);
    const { data, error } = await q;
    if (error) return { error };
    const ms = data?.[0] as MembershipBalance | undefined;
    if (!ms) {
      throw new FormError(
        f.membership_id
          ? "That membership doesn't belong to this member."
          : "This member has no pending fee. Use \"Renew / add plan\" on their profile to start a new membership.",
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

    if (amount > 0) {
      const receipt_no = await nextReceiptNo(sb);
      const ins = await sb.from("payments").insert({ ...pick(f), category: ms.kind, membership_id: ms.id, receipt_no });
      if (ins.error) return ins;
    }

    const remaining = balance - waive - amount;
    const update: Record<string, unknown> = {
      balance_due_on: remaining > EPS ? (f.next_due_on ?? ms.balance_due_on) : null,
    };
    if (waive > 0) {
      update.discount = Number(ms.discount) + waive;
      const note = `Discount ${money(waive, currency)} on ${f.paid_on}${f.notes ? ` (${f.notes})` : ""}`;
      update.notes = ms.notes ? `${ms.notes}
${note}` : note;
    }
    return sb.from("memberships").update(update).eq("id", ms.id);
  });
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

function pick(f: Record<string, unknown>) {
  const { member_id, amount, method, category, paid_on, reference, notes } = f;
  return { member_id, amount, method, category, paid_on, reference, notes };
}
