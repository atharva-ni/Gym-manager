"use server";

import { parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

export async function saveTrainer(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      full_name: "text!",
      phone: "text",
      email: "text",
      role: "text!",
      specialization: "text",
      salary: "number",
      pt_commission_pct: "number",
      joined_on: "date!",
      status: "text!",
      notes: "text",
    });
    row.salary ??= 0;
    row.pt_commission_pct ??= 50;
    return saveRow(sb, "trainers", fd.get("id"), row);
  });
}

/** Record a salary payout as an expense. */
export async function paySalary(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      trainer_id: "uuid!",
      amount: "number!",
      spent_on: "date!",
      method: "text!",
      vendor: "text!",
      description: "text",
    });
    return sb.from("expenses").insert({ ...row, category: "salary" });
  });
}
