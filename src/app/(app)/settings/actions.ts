"use server";

import { FormError, parseForm } from "@/lib/form";
import { runMutation } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      gym_name: "text!",
      phone: "text",
      email: "text",
      address: "text",
      currency: "text!",
      timezone: "text!",
      tax_rate: "number",
      expiry_alert_days: "int!",
      freeze_max_days: "int",
      freeze_fee: "number",
    });
    row.tax_rate ??= 0;
    row.freeze_fee ??= 0;
    if (row.freeze_max_days !== null && Number(row.freeze_max_days) < 1) row.freeze_max_days = null;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: row.timezone as string });
    } catch {
      throw new FormError("Unknown timezone");
    }
    return sb.from("gym_settings").upsert(row, { onConflict: "owner_id" });
  });
}

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };
  return runMutation((sb) => sb.auth.updateUser({ password }));
}
