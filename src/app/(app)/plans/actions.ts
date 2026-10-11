"use server";

import { parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

export async function savePlan(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation(async (sb) => {
    const row = parseForm(fd, {
      name: "text!",
      duration_days: "int!",
      price: "number!",
      admission_fee: "number",
      kind: "text!",
      sessions: "int",
      description: "text",
      is_active: "bool",
    });
    row.admission_fee ??= 0;
    if (row.kind !== "personal_training") row.sessions = null;
    return saveRow(sb, "plans", fd.get("id"), row);
  });
}
