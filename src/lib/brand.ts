import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const BRAND_BUCKET = "brand";
export const DEFAULT_GYM_NAME = "SetFit Fitness";

export type Brand = { name: string; logoUrl: string | null };

/** Public link to a logo in the "brand" bucket (it's public to read). */
export function logoUrlFor(path: string | null | undefined) {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return base ? `${base}/storage/v1/object/public/${BRAND_BUCKET}/${path}` : null;
}

/**
 * The gym's name and logo, readable without signing in (sign-in screen,
 * shared receipts). Falls back to the default name before migration 012.
 */
export const getBrand = cache(async (): Promise<Brand> => {
  const sb = await createClient();
  const { data } = await sb.rpc("gym_public_brand");
  const b = data as { name?: string | null; logo_path?: string | null } | null;
  return { name: b?.name || DEFAULT_GYM_NAME, logoUrl: logoUrlFor(b?.logo_path) };
});
