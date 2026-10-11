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
  const res = await runMutation((sb) => {
    const f = parseForm(fd, { serviced_on: "date!", next_service: "date", cost: "number", notes: "text" });
    return sb.rpc("log_equipment_service", {
      p_equipment_id: String(fd.get("id")),
      p_date: f.serviced_on,
      p_next: f.next_service,
      p_cost: Number(f.cost ?? 0),
      p_notes: f.notes,
    });
  });
  return res?.ok ? { ...res, message: "Service logged" } : res;
}
