"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { FormError, parseForm } from "@/lib/form";
import { runMutation, saveRow } from "@/lib/mutations";
import { getAccess } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

/**
 * Add or edit a staff member. Adding one always creates their app login too:
 * if the login can't be made, the person isn't kept either.
 */
export async function saveTrainer(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  const out = { id, name: "" };
  // Their email is also their login
  const loginEmail = String(fd.get("email") ?? "").trim().toLowerCase();
  const loginPassword = String(fd.get("login_password") ?? "");
  if (!id) {
    // Check the login details first, so nothing is saved for a typo
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) return { error: "Enter their email: it's their app login." };
    if (loginPassword.length < 8) return { error: "Use a temporary password of at least 8 characters." };
  }
  const res = await runMutation(async (sb) => {
    const row = parseForm(fd, {
      full_name: "text!",
      phone: "text",
      email: "text",
      role: "text!",
      specialization: "text",
      salary: "number",
      pt_commission_pct: "number",
      joined_on: "date!",
      status: "text!",
      notes: "text",
    });
    row.salary ??= 0;
    row.pt_commission_pct ??= 50;
    out.name = row.full_name as string;
    if (id) return saveRow(sb, "trainers", id, row);
    const { data, error } = await sb.from("trainers").insert(row).select("id").single();
    if (error) return { error };
    out.id = data.id;
  });
  if (!res?.ok || id) return res;
  const login = await createLogin({ trainerId: out.id, fullName: out.name, email: loginEmail, password: loginPassword });
  if (login.error) {
    // No staff member without a login: undo the insert
    await runMutation((sb) => sb.from("trainers").delete().eq("id", out.id));
    return { error: `${login.error} ${out.name} was not added.` };
  }
  return { ...res, message: `${out.name} added. ${login.message}` };
}

/** Record a salary payout as an expense. */
export async function paySalary(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      trainer_id: "uuid!",
      amount: "number!",
      spent_on: "date!",
      method: "text!",
      vendor: "text!",
      description: "text",
    });
    return sb.from("expenses").insert({ ...row, category: "salary" });
  });
}

/**
 * Create an app login for a staff member (owner only). The login record goes
 * in first, so the optional sign-up hook lets this email through; then the
 * account is created with a separate client, so the owner stays signed in.
 * It is linked to the gym on its first sign-in.
 */
async function createLogin({
  trainerId,
  fullName,
  email: rawEmail,
  password,
}: {
  trainerId: string | null;
  fullName: string;
  email: string;
  password: string;
}): Promise<{ error?: string; message?: string }> {
  const access = await getAccess();
  if (access?.role !== "owner") return { error: "Only the gym owner can create logins." };
  const email = rawEmail.trim().toLowerCase();
  if (!fullName.trim()) return { error: "Enter the staff member's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid login email." };
  if (email === access.user.email?.toLowerCase()) return { error: "That is your own (owner) email." };
  if (password.length < 8) return { error: "Use a temporary password of at least 8 characters." };

  const sb = await createClient();
  const ready = `${fullName} can sign in now with ${email} and the password shown.`;
  // The owner sets the password directly (and the email counts as confirmed),
  // so it works even if this email already had an account. Needs migration 015.
  const setPassword = async (staffId: string) =>
    (await sb.rpc("set_staff_password", { p_staff_id: staffId, p_password: password })).error;

  // Same email as an earlier staff login (e.g. someone deleted and added again):
  // switch that login back on and link it, instead of creating a second one
  const { data: existing } = await sb.from("staff_accounts").select("id").eq("email", email).maybeSingle();
  let staffId: string;
  if (existing) {
    const relinked = await sb
      .from("staff_accounts")
      .update({ active: true, trainer_id: trainerId, full_name: fullName.trim() })
      .eq("id", existing.id);
    if (relinked.error) return { error: relinked.error.message };
    staffId = existing.id;
    const err = await setPassword(staffId);
    if (!err) {
      revalidatePath("/", "layout");
      return { message: ready };
    }
    // No sign-in account behind the old record: create one below
    if (!/no sign-in account/i.test(err.message)) {
      revalidatePath("/", "layout");
      return { message: `${email} already had a login; it's switched back on. ${fullName} signs in with their old password (or uses "Forgot password").` };
    }
  } else {
    const ins = await sb.from("staff_accounts").insert({ full_name: fullName.trim(), email, trainer_id: trainerId }).select("id").single();
    if (ins.error) return { error: ins.error.message };
    staffId = ins.data.id;
  }

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
    if (!existing) await sb.from("staff_accounts").delete().eq("id", staffId);
    return {
      error: /not allowed|disabled/i.test(error.message)
        ? 'Supabase is not accepting new logins. One-time step: in Supabase, open Authentication > Sign In / Providers and turn on "Allow new users to sign up", then try again.'
        : /rate limit/i.test(error.message)
          ? 'Supabase is sending a confirmation email for each new login and has hit its email limit. One-time fix: in Supabase, open Authentication > Sign In / Providers > Email and turn off "Confirm email", then try again (no email is needed after that).'
          : error.message,
    };
  }
  revalidatePath("/", "layout");
  // Make this password the one that works, and skip email confirmation
  if (!(await setPassword(staffId))) return { message: ready };
  // Before migration 015
  return {
    message:
      data.user && data.user.identities?.length === 0
        ? `${email} already has a login. ${fullName} can sign in with that password (or use "Forgot password") and will get staff access.`
        : data.session
          ? ready
          : `Login created. ${fullName} must click the confirmation link emailed to ${email}, then sign in with the temporary password.`,
  };
}

/** "Give app login" on a staff member's card. */
export async function addStaff(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await createLogin({
    trainerId: String(fd.get("trainer_id") ?? "") || null,
    fullName: String(fd.get("full_name") ?? ""),
    email: String(fd.get("email") ?? ""),
    password: String(fd.get("password") ?? ""),
  });
  return r.error ? { error: r.error } : { ok: true, at: Date.now(), message: r.message };
}

/** Switch a staff login off (access stops at once) or back on. */
export async function setStaffActive(id: string, active: boolean): Promise<ActionState> {
  return runMutation((sb) => sb.from("staff_accounts").update({ active }).eq("id", id));
}

/** Most a staff login may discount, in % of the fee (empty = no limit). */
export async function saveStaffLimit(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const { staff_max_discount_pct: cap } = parseForm(fd, { staff_max_discount_pct: "number" });
    if (cap !== null && (Number(cap) < 0 || Number(cap) > 100)) throw new FormError("The limit must be between 0 and 100%");
    return sb.from("gym_settings").upsert({ staff_max_discount_pct: cap }, { onConflict: "owner_id" });
  });
}

/** Delete an app login completely (sign-in account too), e.g. one left from a deleted staff member. */
export async function deleteStaffLogin(id: string): Promise<ActionState> {
  return runMutation((sb) => sb.rpc("delete_staff_login", { p_staff_id: id }));
}

/** Give a staff member a new password (owner only; no email needed). */
export async function resetStaffPassword(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };
  const res = await runMutation((sb) => sb.rpc("set_staff_password", { p_staff_id: id, p_password: password }));
  return res?.ok ? { ...res, message: "Password changed. Send them the new one." } : res;
}
