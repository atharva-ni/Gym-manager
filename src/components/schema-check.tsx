import { createClient } from "@/lib/supabase/server";

/**
 * Warns when the Supabase database is older than the app (a migration in
 * supabase/migrations hasn't been run yet), instead of failing silently.
 */
export async function SchemaCheck() {
  const sb = await createClient();
  const [ms, pay] = await Promise.all([
    sb.from("memberships").select("kind, balance_due_on, sessions_used").limit(1),
    sb.from("payments").select("receipt_no").limit(1),
  ]);
  const error = ms.error ?? pay.error;
  if (!error) return null;
  const pending = ms.error ? "002_payments_and_pt.sql and then 003_receipts.sql" : "003_receipts.sql";

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
