"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { runMutation } from "@/lib/mutations";
import type { ActionState } from "@/lib/types";

const DELETABLE = new Set([
  "plans", "trainers", "members", "memberships", "payments", "attendance", "measurements",
  "classes", "expenses", "products", "sales", "equipment", "leads",
]);

export async function deleteRecord(table: string, id: string): Promise<ActionState> {
  if (!DELETABLE.has(table)) return { error: "Not allowed" };
  return runMutation((sb) => sb.from(table).delete().eq("id", id));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
