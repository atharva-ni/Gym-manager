"use server";

import { FormError, parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import { getOwner, getSettings } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import type { ActionState } from "@/lib/types";

const MAX_BILL_BYTES = 5 * 1024 * 1024;
const BILL_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

/** Save an expense, with an optional photo / PDF of the bill (private storage). */
export async function saveExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  const owner = await getOwner();
  return runMutation(async (sb) => {
    const row = parseForm(fd, {
      category: "text!",
      amount: "number!",
      spent_on: "date!",
      vendor: "text",
      description: "text",
      method: "text!",
    });
    const file = fd.get("bill");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BILL_BYTES) throw new FormError("Bill photo must be under 5 MB");
      if (!BILL_TYPES.includes(file.type)) throw new FormError("Bill must be a photo (JPG, PNG, WebP, HEIC) or a PDF");
      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${owner!.id}/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from("bills").upload(path, file, { contentType: file.type });
      if (up.error) {
        throw new FormError(
          `Could not upload the bill (${up.error.message}). Run the latest database update (006) so the "bills" storage bucket exists.`,
        );
      }
      row.bill_path = path;
    }
    return saveRow(sb, "expenses", fd.get("id"), row);
  });
}

export async function saveRecurringExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      category: "text!",
      amount: "number!",
      day_of_month: "int!",
      vendor: "text",
      description: "text!",
      method: "text!",
      trainer_id: "uuid",
      is_active: "bool",
    });
    const day = Number(row.day_of_month);
    if (day < 1 || day > 28) throw new FormError("Day of month must be between 1 and 28");
    return saveRow(sb, "recurring_expenses", fd.get("id"), row);
  });
}

/** Add this month's recurring expenses whose day has come and that aren't added yet. */
export async function postRecurringExpenses(): Promise<ActionState> {
  const { timezone } = await getSettings();
  const out = { n: 0 };
  const res = await runMutation(async (sb) => {
    const { data, error } = await sb.rpc("post_recurring_expenses", { p_today: todayISO(timezone) });
    if (error) return { error };
    out.n = Number(data ?? 0);
  });
  return res?.ok ? { ...res, message: out.n ? `${out.n} recurring expense${out.n === 1 ? "" : "s"} added` : "Nothing due yet" } : res;
}
