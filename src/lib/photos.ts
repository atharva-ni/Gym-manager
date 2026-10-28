import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FormError } from "@/lib/form";

export const PHOTO_BUCKET = "member-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** The photo file in a member form, or null when none was chosen. */
export function photoFromForm(fd: FormData): File | null {
  const file = fd.get("photo");
  return file instanceof File && file.size > 0 ? file : null;
}

/** Upload a member photo into the gym's folder; returns its storage path. */
export async function uploadMemberPhoto(sb: SupabaseClient, gymId: string, file: File): Promise<string> {
  if (file.size > MAX_PHOTO_BYTES) throw new FormError("Photo must be under 5 MB");
  if (!PHOTO_TYPES.includes(file.type)) throw new FormError("Photo must be a JPG, PNG, WebP or HEIC image");
  const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${gymId}/${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type });
  if (up.error) {
    throw new FormError(
      `Could not upload the photo (${up.error.message}). Run the latest database update (008) so the "member-photos" storage bucket exists.`,
    );
  }
  return path;
}

/** Signed links (valid 1 hour) for private photos, keyed by storage path. */
export async function photoUrls(sb: SupabaseClient, paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean) as string[])];
  if (!unique.length) return new Map();
  const { data } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(unique, 3600);
  const urls = new Map<string, string>();
  for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  return urls;
}

/** Best-effort delete of files that are no longer used (never fails the action). */
export async function removeFiles(sb: SupabaseClient, bucket: string, paths: (string | null | undefined)[]) {
  const list = paths.filter(Boolean) as string[];
  if (list.length) await sb.storage.from(bucket).remove(list).catch(() => undefined);
}
