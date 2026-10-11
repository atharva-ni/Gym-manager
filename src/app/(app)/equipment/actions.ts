"use server";

import { parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

export async function saveEquipment(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      name: "text!",
      category: "text!",
      brand: "text",
      serial_no: "text",
      quantity: "int!",
      purchase_date: "date",
      purchase_cost: "number",
      status: "text!",
      last_service: "date",
      next_service: "date",
      notes: "text",
    });
    row.purchase_cost ??= 0;
    return saveRow(sb, "equipment", fd.get("id"), row);
  });
}

/** Log a service: sets last/next service dates, marks working, optionally books the cost. */
export async function logService(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation(async (sb) => {
    const f = parseForm(fd, { serviced_on: "date!", next_service: "date", cost: "number", notes: "text" });
    const id = String(fd.get("id"));
    const { data: eq, error } = await sb.from("equipment").select("name").eq("id", id).single();
    if (error) return { error };
    const upd = await sb
      .from("equipment")
      .update({ last_service: f.serviced_on, next_service: f.next_service, status: "working" })
      .eq("id", id);
    if (upd.error) return upd;
    if (f.cost && Number(f.cost) > 0) {
      return sb.from("expenses").insert({
        category: "maintenance",
        amount: f.cost,
        spent_on: f.serviced_on,
        description: `Service: ${eq.name}${f.notes ? ` (${f.notes})` : ""}`,
      });
    }
  });
}
