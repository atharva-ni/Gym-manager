import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Settings } from "@/lib/types";

export function isOwnerEmail(email: string | undefined) {
  const allowed = (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length === 0 || (!!email && allowed.includes(email.toLowerCase()));
}

/** The signed-in owner, or null. Verified against Supabase Auth. */
export const getOwner = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isOwnerEmail(data.user.email)) return null;
  return data.user;
});

/** Use in pages/layouts: redirects to /login when not signed in as the owner. */
export async function requireOwner() {
  const user = await getOwner();
  if (!user) redirect("/login?error=unauthorized");
  return user;
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
  const user = await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase.from("gym_settings").select("*").maybeSingle();
  return (data as Settings | null) ?? { owner_id: user.id, ...DEFAULT_SETTINGS };
});
