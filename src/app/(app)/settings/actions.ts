"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { FormError, parseForm } from "@/lib/form";
import { runMutation } from "@/lib/mutations";
import { getAccess } from "@/lib/auth";
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
 * Change your login email. Supabase emails a confirmation link (to the new
 * address, and to the old one too when "Secure email change" is on); the new
 * email only works after the link is clicked. Nothing else needs changing:
 * the database knows the owner by account, not by email.
 */
export async function changeLoginEmail(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  const access = await getAccess();
  if (access?.role !== "owner") return { error: "Only the gym owner can change this. Staff logins are managed in Settings > Staff." };
  const owner = access.user;
  if (email === owner.email?.toLowerCase()) return { error: "That is already your login email." };
  const site = await siteUrl();
  const res = await runMutation((sb) => sb.auth.updateUser({ email }, { emailRedirectTo: `${site}/auth/confirm?next=/settings` }));
  return res?.ok
    ? {
        ...res,
        message: `Confirmation sent. Click the link emailed to ${email} (and to your current address, if asked). Until then, keep signing in with ${owner.email}.`,
      }
    : res;
}

/**
 * Add a staff login (owner only). The staff record goes in first, so the
 * optional sign-up hook lets this email through; then the login is created
 * with a separate client, so the owner stays signed in. The account is linked
 * to the gym on its first sign-in.
 */
export async function addStaff(_: ActionState, fd: FormData): Promise<ActionState> {
  const access = await getAccess();
  if (access?.role !== "owner") return { error: "Only the gym owner can add staff." };
  const fullName = String(fd.get("full_name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!fullName) return { error: "Enter the staff member's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (email === access.user.email?.toLowerCase()) return { error: "That is your own (owner) email." };
  if (password.length < 8) return { error: "Use a temporary password of at least 8 characters." };

  const saved = await runMutation((sb) => sb.from("staff_accounts").insert({ full_name: fullName, email }));
  if (!saved?.ok) return saved;

  const auth = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const site = await siteUrl();
  const { data, error } = await auth.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${site}/auth/confirm?next=/attendance`, data: { full_name: fullName } },
  });
  if (error) {
    await runMutation((sb) => sb.from("staff_accounts").delete().eq("email", email));
    return {
      error: /not allowed|disabled/i.test(error.message)
        ? 'Supabase is not accepting new logins. One-time step: in Supabase, open Authentication > Sign In / Providers and turn on "Allow new users to sign up", then try again.'
        : error.message,
    };
  }
  const message =
    data.user && data.user.identities?.length === 0
      ? `${email} already has a login. ${fullName} can sign in with that password (or use "Forgot password") and will get staff access.`
      : data.session
        ? `${fullName} can sign in now with ${email} and the temporary password.`
        : `Login created. ${fullName} must click the confirmation link emailed to ${email}, then sign in with the temporary password.`;
  return { ...saved, message };
}

/** Switch a staff login off (access stops at once) or back on. */
export async function setStaffActive(id: string, active: boolean): Promise<ActionState> {
  return runMutation((sb) => sb.from("staff_accounts").update({ active }).eq("id", id));
}
