import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import type { Settings } from "@/lib/types";

export type Role = "owner" | "staff";
export type Access = {
  user: User;
  role: Role;
  /** The gym owner's id: owner_id of every row and the storage folder. */
  gymId: string;
  /** Staff member's name (null for the owner). */
  name: string | null;
};

/**
 * The signed-in account and what it may do, or null. The database decides
 * (my_access): the owner is the account that owns the gym, staff are the
 * logins the owner added in Settings > Staff. Everyone else gets null.
 */
export const getAccess = cache(async (): Promise<Access | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: acc, error } = await supabase.rpc("my_access");
  if (error) {
    // Database not updated to 009 yet: keep working as the owner so the
    // "Database update needed" banner can say what to run.
    if (error.code === "PGRST202" || error.code === "42883") {
      return { user: data.user, role: "owner", gymId: data.user.id, name: null };
    }
    return null;
  }
  const a = acc as { role: string; gym_id: string | null; name?: string | null } | null;
  if (!a?.gym_id || (a.role !== "owner" && a.role !== "staff")) return null;
  return { user: data.user, role: a.role, gymId: a.gym_id, name: a.name ?? null };
});

/** Use in pages/layouts: redirects to /login unless signed in as the owner or staff. */
export async function requireAccess() {
  const access = await getAccess();
  if (!access) redirect("/login?error=unauthorized");
  return access;
}

/** Owner-only pages: staff are sent to the check-in screen. */
export async function requireOwner() {
  const access = await requireAccess();
  if (access.role !== "owner") redirect("/attendance");
  return access;
}

const DEFAULT_SETTINGS: Omit<Settings, "owner_id"> = {
  gym_name: "SetFit Fitness",
  phone: "+91 88559 98620",
  email: null,
  address: "Beside The Tree House High School, DP Road, Karvenagar, Pune, Maharashtra 411052",
  currency: "INR",
  timezone: "Asia/Kolkata",
  tax_rate: 0,
  expiry_alert_days: 7,
  freeze_max_days: null,
  freeze_fee: 0,
};

export const getSettings = cache(async (): Promise<Settings> => {
  const { gymId } = await requireAccess();
  const supabase = await createClient();
  const { data } = await supabase.from("gym_settings").select("*").eq("owner_id", gymId).maybeSingle();
  return (data as Settings | null) ?? { owner_id: gymId, ...DEFAULT_SETTINGS };
});
