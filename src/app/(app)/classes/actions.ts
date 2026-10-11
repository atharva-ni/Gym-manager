"use server";

import { FormError, parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

export async function saveClass(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      name: "text!",
      trainer_id: "uuid",
      day_of_week: "int!",
      start_time: "time!",
      end_time: "time!",
      capacity: "int!",
      room: "text",
      is_active: "bool",
    });
    if ((row.end_time as string) <= (row.start_time as string)) throw new FormError("End time must be after start time");
    return saveRow(sb, "classes", fd.get("id"), row);
  });
}
