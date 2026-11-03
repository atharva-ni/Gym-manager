"use server";

import { FormError, parseForm } from "@/lib/form";
import { runMutation } from "@/lib/mutations";
import { getAccess } from "@/lib/auth";
import { BRAND_BUCKET } from "@/lib/brand";
import { removeFiles } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";
import type { ActionState } from "@/lib/types";

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Gym profile and logo: shown on receipts, shared links and the sign-in screen. */
export async function saveGymProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const access = await getAccess();
  let oldLogo: string | null = null;
  const res = await runMutation(async (sb) => {
    const row = parseForm(fd, {
      gym_name: "text!",
      phone: "text",
      email: "text",
      address: "text",
      tax_rate: "number",
    });
    row.tax_rate ??= 0;
    const file = fd.get("logo");
    const upload = file instanceof File && file.size > 0 ? file : null;
    if (upload || fd.get("remove_logo") === "on") {
      oldLogo = (await sb.from("gym_settings").select("logo_path").maybeSingle()).data?.logo_path ?? null;
      row.logo_path = null;
    }
    if (upload) {
      const ext = LOGO_TYPES[upload.type];
      if (!ext) throw new FormError("Logo must be a PNG, JPG or WebP image");
      if (upload.size > 2 * 1024 * 1024) throw new FormError("Logo must be under 2 MB");
      const path = `${access!.gymId}/logo-${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from(BRAND_BUCKET).upload(path, upload, { contentType: upload.type });
      if (up.error) {
        throw new FormError(`Could not upload the logo (${up.error.message}). Run the latest database update (012) so the "brand" bucket exists.`);
      }
      row.logo_path = path;
    }
    return sb.from("gym_settings").upsert(row, { onConflict: "owner_id" });
  });
  if (res?.ok && oldLogo) await removeFiles(await createClient(), BRAND_BUCKET, [oldLogo]);
  return res;
}

/** Currency, timezone, expiry alerts and freeze rules. */
export async function saveRules(_: ActionState, fd: FormData): Promise<ActionState> {
  return runMutation((sb) => {
    const row = parseForm(fd, {
      currency: "text!",
      timezone: "text!",
      expiry_alert_days: "int!",
      freeze_max_days: "int",
      freeze_fee: "number",
    });
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
  if (access?.role !== "owner") return { error: "Only the gym owner can change this. Staff logins are managed on the Staff page." };
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
