"use server";

import { parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

export async function saveLead(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      full_name: "text!",
      phone: "text",
      email: "text",
      source: "text!",
      interest: "text",
      status: "text!",
      follow_up_on: "date",
      notes: "text",
    });
    return saveRow(sb, "leads", fd.get("id"), row);
  });
}

export async function setLeadStatus(id: string, status: string): Promise<ActionState> {
  return runMutation((sb) => sb.from("leads").update({ status }).eq("id", id));
}
