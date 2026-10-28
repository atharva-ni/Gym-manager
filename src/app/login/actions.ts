"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";
import type { ActionState } from "@/lib/types";

export async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // The database decides who may use the gym (owner, or staff the owner added)
  const { data: access, error: accessError } = await supabase.rpc("my_access");
  const role = accessError ? "owner" : (access as { role?: string } | null)?.role; // before migration 009: as before
  if (role === "unclaimed") {
    await supabase.rpc("claim_gym"); // brand-new install: the first account becomes the owner
  } else if (role !== "owner" && role !== "staff") {
    await supabase.auth.signOut();
    return {
      error:
        role === "inactive"
          ? "Your staff login has been switched off. Ask the gym owner."
          : "This account is not allowed to access this gym.",
    };
  }
  redirect(role === "staff" ? "/attendance" : "/");
}

/** Emails a password reset link. Always answers the same, so it can't be used to test emails. */
export async function sendPasswordReset(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  const site = await siteUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${site}/auth/confirm?next=/reset-password`,
  });
  // Too many requests is worth showing; anything else would reveal whether the email exists
  if (error?.status === 429) return { error: "Too many attempts. Wait a minute and try again." };
  return {
    ok: true,
    at: Date.now(),
    message: `If ${email} has an account, a reset link is on its way. Open it on this device.`,
  };
}

/** Sets a new password after opening the reset link (the link signs you in). */
export async function setNewPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "The reset link has expired. Ask for a new one." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/");
}
