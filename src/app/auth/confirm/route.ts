import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in Supabase emails (password reset, email change,
 * sign-up confirmation). Turns the link into a session, then moves on to
 * `next`. Handles both link styles: `?code=` (default) and `?token_hash=&type=`.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get("next");
  // Only same-site paths, never another host
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  const supabase = await createClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("missing token") };

  const dest = url.clone();
  dest.search = "";
  if (error) {
    dest.pathname = "/forgot";
    dest.searchParams.set("expired", "1");
  } else {
    dest.pathname = target;
  }
  return NextResponse.redirect(dest);
}
