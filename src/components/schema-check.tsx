import { createClient } from "@/lib/supabase/server";

/**
 * Warns when the Supabase database is older than the app (a migration in
 * supabase/migrations hasn't been run yet), instead of failing silently.
 */
export async function SchemaCheck() {
  // In production, migrations are already run; skip the extra database queries on every page request.
  if (process.env.NODE_ENV === "production" && process.env.CHECK_SCHEMA !== "true") {
    return null;
  }
  const sb = await createClient();
  const [ms, pay, v4, v6, v8, v9, v10, v11, v12] = await Promise.all([
    sb.from("memberships").select("kind, balance_due_on, sessions_used").limit(1),
    sb.from("payments").select("receipt_no").limit(1),
    sb.from("refunds").select("id").limit(1),
    sb.from("pt_sessions").select("id").limit(1),
    sb.from("members").select("photo_path").limit(1),
    sb.from("activity_log").select("id").limit(1),
    sb.from("plans").select("duration_months").limit(1),
    sb.rpc("day_close", { p_day: "2000-01-01" }),
    sb.from("gym_settings").select("logo_path").limit(1),
  ]);
  // day_close refuses staff; only a missing function means 011 isn't run
  const missing011 = v11.error && (v11.error.code === "PGRST202" || v11.error.code === "42883") ? v11.error : null;
  const error = ms.error ?? pay.error ?? v4.error ?? v6.error ?? v8.error ?? v9.error ?? v10.error ?? missing011 ?? v12.error;
  if (!error) return null;
  const pending = ms.error
    ? "002_payments_and_pt.sql, then 003_receipts.sql, then 004_freeze_refunds_passes.sql"
    : pay.error
      ? "003_receipts.sql, then 004_freeze_refunds_passes.sql"
      : v4.error
        ? "004_freeze_refunds_passes.sql, then 005_unfreeze_status.sql, then 006_operations.sql"
        : v6.error
          ? "006_operations.sql (after 005_unfreeze_status.sql)"
          : v8.error
            ? "007_performance_optimization.sql, then 008_member_photos.sql, 009_staff_and_activity.sql and 010_plan_options.sql"
            : v9.error
              ? "009_staff_and_activity.sql (after 008_member_photos.sql), then 010_plan_options.sql"
              : v10.error
                ? "010_plan_options.sql (after 009_staff_and_activity.sql), then 011_desk_fixes.sql"
                : missing011
                  ? "011_desk_fixes.sql (after 010_plan_options.sql), then 012_branding.sql"
                  : "012_branding.sql (after 011_desk_fixes.sql)";

  const missingTable = error.code === "42P01" || /relation .* does not exist/i.test(error.message);
  return (
    <div className="mb-6 rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">
      <p className="font-semibold">Database update needed</p>
      {missingTable ? (
        <p className="mt-1">
          The tables are missing. In Supabase, open SQL Editor and run <code>supabase/schema.sql</code>.
        </p>
      ) : (
        <p className="mt-1">
          Your database is missing new columns. In Supabase, open SQL Editor and run{" "}
          <code>supabase/migrations/{pending}</code> once, then reload this page.
        </p>
      )}
      <p className="mt-1 text-xs opacity-80">Details: {error.message}</p>
    </div>
  );
}
