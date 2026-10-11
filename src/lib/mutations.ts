import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, type Row } from "@/lib/form";
import type { ActionState } from "@/lib/types";

type DbResult = { error: { message: string; code?: string } | null } | void;

function friendly(err: { message: string; code?: string }) {
  if (err.code === "23505") return "A record with these details already exists.";
  if (err.code === "23503" || err.code === "23001") {
    return "This record has payments or other data linked to it, so it can't be deleted. Cancel it or mark it inactive instead.";
  }
  if (err.code === "23514") return "Some values are out of the allowed range.";
  return err.message;
}

/**
 * Runs a database mutation as the signed-in owner, converts errors to
 * a user-facing message and revalidates the app on success.
 */
export async function runMutation(fn: (sb: SupabaseClient) => PromiseLike<DbResult>): Promise<ActionState> {
  try {
    if (!(await getOwner())) return { error: "Your session has expired. Please sign in again." };
    const sb = await createClient();
    const res = await fn(sb);
    if (res && res.error) return { error: friendly(res.error) };
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, at: Date.now() };
}

/** Insert when `id` is empty, otherwise update that row. */
export function saveRow(sb: SupabaseClient, table: string, id: FormDataEntryValue | null, row: Row) {
  return id ? sb.from(table).update(row).eq("id", String(id)) : sb.from(table).insert(row);
}

