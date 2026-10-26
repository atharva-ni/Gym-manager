"use server";

import { FormError, parseForm } from "@/lib/form";
import { runMutation } from "@/lib/mutations";
import { getOwner, isOwnerEmail } from "@/lib/auth";
import { siteUrl } from "@/lib/site";
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

/**
 * Change the owner's login email. Supabase emails a confirmation link (to the
 * new address, and to the old one too when "Secure email change" is on); the
 * new email only works after the link is clicked. The new address must be on
 * OWNER_EMAILS first, otherwise the owner would be locked out.
 */
export async function changeLoginEmail(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  const owner = await getOwner();
  if (!owner) return { error: "Your session has expired. Please sign in again." };
  if (email === owner.email?.toLowerCase()) return { error: "That is already your login email." };
  if (!isOwnerEmail(email)) {
    return {
      error: `Add ${email} to OWNER_EMAILS first (in .env.local, and in Vercel if the app is deployed), restart the app, then try again. Otherwise the new email would be blocked from signing in.`,
    };
  }
  const site = await siteUrl();
  const res = await runMutation((sb) => sb.auth.updateUser({ email }, { emailRedirectTo: `${site}/login` }));
  return res?.ok
    ? {
        ...res,
        message: `Confirmation sent. Click the link emailed to ${email} (and to your current address, if asked). Until then, keep signing in with ${owner.email}.`,
      }
    : res;
}
