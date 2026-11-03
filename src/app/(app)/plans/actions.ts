"use server";

import { FormError, parseForm } from "@/lib/form";
import { runMutation } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

/** Create or edit a plan with all its durations (save_plan_group, one transaction). */
export async function savePlanGroup(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const kind = String(fd.get("kind") ?? "");
    const name = String(fd.get("name") ?? "").trim();
    const oldName = String(fd.get("old_name") ?? "") || null;
    let options: unknown[];
    try {
      options = JSON.parse(String(fd.get("options") ?? "[]"));
    } catch {
      throw new FormError("Could not read the durations. Please try again.");
    }
    if (!name) throw new FormError("Give the plan a name");
    if (!options.length) throw new FormError("Add at least one duration with a price");
    return sb.rpc("save_plan_group", {
      p_kind: kind,
      p_old_name: oldName,
      p_name: name,
      p_description: String(fd.get("description") ?? ""),
      p_active: fd.get("is_active") === "on",
      p_options: options,
    });
  });
}

/** Remove a plan: durations never sold are deleted, sold ones are switched off. */
export async function deletePlanGroup(kind: string, name: string): Promise<ActionState> {
  return runMutation((sb) => sb.rpc("delete_plan_group", { p_kind: kind, p_name: name }));
}

/** The one-time admission fee for new admissions (kept in gym settings). */
export async function saveAdmissionFee(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const { admission_fee } = parseForm(fd, { admission_fee: "number!" });
    if (Number(admission_fee) < 0) throw new FormError("The admission fee can't be negative");
    return sb.from("gym_settings").upsert({ admission_fee }, { onConflict: "owner_id" });
  });
}
