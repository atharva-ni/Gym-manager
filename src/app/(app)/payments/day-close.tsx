import Link from "next/link";
import Form from "next/form";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { addDays, fmtDate, fmtTime, money, plural } from "@/lib/format";
import { label } from "@/lib/constants";
import { Card, Empty, Stat, TableWrap } from "@/components/ui";

type CloseRow = { method: string; received: number; refunded: number; sales: number; net: number; entries: number };
type DayPayment = {
  id: string;
  amount: number;
  method: string;
  receipt_no: string | null;
  category: string;
  created_at: string;
  member_id: string;
  members: { full_name: string; member_code: string } | null;
};

/**
 * End-of-day count (owner only): money in and out on one day by payment
 * mode, so cash in the drawer can be matched, and who took each payment.
 */
export async function DayClose({ day, today, currency, timezone }: { day: string; today: string; currency: string; timezone: string }) {
  const sb = await createClient();
  const [{ data: closeRows, error }, { data: payRows }, { data: staffRows }] = await Promise.all([
    sb.rpc("day_close", { p_day: day }),
    sb
      .from("payments")
      .select("id, amount, method, receipt_no, category, created_at, member_id, members(full_name, member_code)")
      .eq("paid_on", day)
      .order("created_at")
      .limit(1000),
    sb.from("staff_accounts").select("email, full_name"),
  ]);
  const rows = ((closeRows ?? []) as CloseRow[]).map((r) => ({
    ...r,
    received: Number(r.received),
    refunded: Number(r.refunded),
    sales: Number(r.sales),
    net: Number(r.net),
  }));
  const payments = (payRows ?? []) as unknown as DayPayment[];

  // Who entered each payment, from the activity log
  const ids = payments.map((p) => p.id);
  const { data: logRows } = ids.length
    ? await sb.from("activity_log").select("record_id, actor_role, actor_email").eq("table_name", "payments").eq("action", "insert").in("record_id", ids)
    : { data: [] };
  const staffName = new Map((staffRows ?? []).map((s) => [String(s.email).toLowerCase(), s.full_name as string]));
  const takenBy = new Map(
    (logRows ?? []).map((l) => [
      l.record_id as string,
      l.actor_role === "owner" ? "Owner" : l.actor_role === "staff" ? (staffName.get(String(l.actor_email).toLowerCase()) ?? "Staff") : "System",
    ]),
  );

  const total = rows.reduce((s, r) => s + r.net, 0);
  const cash = rows.find((r) => r.method === "cash");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <Link href={`/payments?tab=close&date=${addDays(day, -1)}`} className="btn-secondary" aria-label="Previous day">
          <ChevronLeft size={16} />
        </Link>
        <Form action="/payments" className="flex items-end gap-2">
          <input type="hidden" name="tab" value="close" />
          <label>
            <span className="label">Day</span>
            <input type="date" name="date" defaultValue={day} max={today} className="input w-auto" />
          </label>
          <button className="btn-secondary">Show</button>
        </Form>
        {day < today && (
          <Link href={`/payments?tab=close&date=${addDays(day, 1)}`} className="btn-secondary" aria-label="Next day">
            <ChevronRight size={16} />
          </Link>
        )}
      </div>

      {error ? (
        <Card>
          <Empty>
            Day close needs the latest database update. Run <code>supabase/migrations/011_desk_fixes.sql</code> in the Supabase SQL Editor.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label={`Net in ${day === today ? "today" : fmtDate(day)}`} value={money(total, currency)} hint="Payments + counter sales - refunds" tone="brand" />
            <Stat label="Cash in drawer" value={money(cash?.net ?? 0, currency)} hint="Should match the cash you count" tone="good" />
            {rows
              .filter((r) => r.method !== "cash")
              .slice(0, 2)
              .map((r) => (
                <Stat key={r.method} label={label(r.method)} value={money(r.net, currency)} hint={plural(Number(r.entries), "entry", "entries")} />
              ))}
          </div>

          <Card title="By payment mode" bodyClass="">
            {!rows.length ? (
              <Empty>No money in or out on this day.</Empty>
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Mode</th>
                      <th className="num">Fees received</th>
                      <th className="num">Counter sales</th>
                      <th className="num">Refunds paid</th>
                      <th className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.method}>
                        <td className="font-medium text-ink">{label(r.method)}</td>
                        <td className="num">{money(r.received, currency)}</td>
                        <td className="num">{money(r.sales, currency)}</td>
                        <td className="num text-bad">{r.refunded ? `- ${money(r.refunded, currency)}` : "-"}</td>
                        <td className="num font-semibold text-ink">{money(r.net, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title={`Payments (${payments.length})`} bodyClass="">
            {!payments.length ? (
              <Empty>No fee payments on this day.</Empty>
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Entered</th>
                      <th>Mode</th>
                      <th>Receipt</th>
                      <th className="num">Amount</th>
                      <th>Taken by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/members/${p.member_id}`} className="text-ink hover:text-brand">
                            {p.members?.full_name ?? "Member"} <span className="text-xs text-muted">{p.members?.member_code}</span>
                          </Link>
                        </td>
                        <td className="whitespace-nowrap">{fmtTime(p.created_at, timezone)}</td>
                        <td>{label(p.method)}</td>
                        <td className="text-xs">{p.receipt_no ?? "-"}</td>
                        <td className="num font-medium text-ink">{money(p.amount, currency)}</td>
                        <td>{takenBy.get(p.id) ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
