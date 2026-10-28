import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccess } from "@/lib/auth";
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
  if (err.code === "42501") {
    // Our own permission errors carry a readable message; RLS rejections don't
    return /row-level security/i.test(err.message) ? "Only the gym owner can do this." : err.message;
  }
  if (err.code === "PGRST202" || err.code === "42883") {
    return "Database update needed: run the newest file in supabase/migrations in the Supabase SQL Editor, then try again.";
  }
  return err.message;
}

/**
 * Runs a database mutation as the signed-in owner or staff (the database
 * limits what staff can change), converts errors to
 * a user-facing message and revalidates the app on success.
 */
export async function runMutation(fn: (sb: SupabaseClient) => PromiseLike<DbResult>): Promise<ActionState> {
  try {
    if (!(await getAccess())) return { error: "Your session has expired. Please sign in again." };
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

