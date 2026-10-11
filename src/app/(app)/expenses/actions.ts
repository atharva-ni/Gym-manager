"use server";

import { parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

export async function saveExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      category: "text!",
      amount: "number!",
      spent_on: "date!",
      vendor: "text",
      description: "text",
      method: "text!",
    });
    return saveRow(sb, "expenses", fd.get("id"), row);
  });
}
