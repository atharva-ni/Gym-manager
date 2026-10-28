import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings, requireOwner } from "@/lib/auth";
import { addDays, addMonths, dayBoundsUTC, daysBetween, fmtDate, money, monthLabel, todayISO } from "@/lib/format";
import { DAYS, label } from "@/lib/constants";
import { rangeParams } from "@/lib/queries";
import { Card, Empty, PageHeader, Stat, TableWrap } from "@/components/ui";
import { DateRangeFilter } from "@/components/date-range";
import { RevenueExpenseChart, SimpleBarChart } from "@/components/charts";

export const metadata = { title: "Reports · SetFit Fitness" };

type Finance = { month: string; payments: number; sales: number; expenses: number };
type Breakdown = { dimension: string; key: string; total: number; entries: number };

const PRESETS = (today: string) => [
  { label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
  { label: "Last month", from: addMonths(today, -1), to: addDays(`${today.slice(0, 7)}-01`, -1) },
  { label: "Last 6 months", from: addMonths(today, -5), to: today },
  { label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
];

export default async function ReportsPage(props: PageProps<"/reports">) {
  const sp = await props.searchParams;
  await requireOwner(); // staff are sent to check-in
  const settings = await getSettings();
  const { currency, timezone: tz } = settings;
  const today = todayISO(tz);
  const { from, to } = rangeParams({ from: addMonths(today, -5), ...sp }, today);
  const bounds = dayBoundsUTC(from, tz, to);
  const sb = await createClient();

  const [fin, pay, exp, plans, products, joined, byHour, byDow, byDay, lapsed] = await Promise.all([
    sb.rpc("finance_monthly", { p_from: from, p_to: to }),
    sb.rpc("payment_breakdown", { p_from: from, p_to: to }),
    sb.rpc("expense_breakdown", { p_from: from, p_to: to }),
    sb.rpc("plan_breakdown", { p_from: from, p_to: to }),
    sb.rpc("sales_breakdown", { p_from: from, p_to: to }),
    sb.rpc("members_monthly", { p_from: from, p_to: to }),
    sb.rpc("attendance_by_hour", { p_from: bounds.start, p_to: bounds.end, p_tz: tz }),
    sb.rpc("attendance_by_weekday", { p_from: bounds.start, p_to: bounds.end, p_tz: tz }),
    sb.rpc("attendance_by_day", { p_from: bounds.start, p_to: bounds.end, p_tz: tz }),
    sb
      .from("member_overview")
      .select("id", { count: "exact", head: true })
      .neq("status", "inactive")
      .eq("membership_kind", "membership")
      .gte("membership_end", from)
      .lte("membership_end", to < today ? to : addDays(today, -1)),
  ]);

  const firstError = [fin, pay, exp, plans, products, joined, byHour, byDow, byDay].find((r) => r.error)?.error;

  const finance = (fin.data ?? []) as Finance[];
  const totalPayments = finance.reduce((s, r) => s + Number(r.payments), 0);
  const totalSales = finance.reduce((s, r) => s + Number(r.sales), 0);
  const revenue = totalPayments + totalSales;
  const expenses = finance.reduce((s, r) => s + Number(r.expenses), 0);
  const profit = revenue - expenses;

  const breakdown = (pay.data ?? []) as Breakdown[];
  const byMethod = breakdown.filter((b) => b.dimension === "method").map((b) => ({ label: label(b.key), value: Number(b.total) })).sort((a, b) => b.value - a.value);
  const byCategory = breakdown
    .filter((b) => b.dimension === "category" && b.key !== "refund")
    .map((b) => ({ label: label(b.key), value: Number(b.total) }))
    .sort((a, b) => b.value - a.value);
  const refundsInRange = -breakdown.filter((b) => b.dimension === "category" && b.key === "refund").reduce((s, b) => s + Number(b.total), 0);
  const expCats = ((exp.data ?? []) as { category: string; total: number }[]).map((e) => ({ label: label(e.category), value: Number(e.total) }));

  const planRows = (plans.data ?? []) as { plan_name: string; sold: number; revenue: number }[];
  const productRows = (products.data ?? []) as { product_name: string; quantity: number; revenue: number; profit: number }[];
  const joinedRows = ((joined.data ?? []) as { month: string; joined: number }[]).map((r) => ({ label: monthLabel(r.month), value: Number(r.joined) }));
  const newMembers = joinedRows.reduce((s, r) => s + r.value, 0);

  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of (byHour.data ?? []) as { hour: number; visits: number }[]) hours[r.hour] = Number(r.visits);
  const first = hours.findIndex((h) => h > 0);
  const last = 23 - [...hours].reverse().findIndex((h) => h > 0);
  const hourData = first === -1 ? [] : hours.slice(first, last + 1).map((v, i) => {
    const h = first + i;
    return { label: `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`, value: v };
  });
  const dow = Array.from({ length: 7 }, () => 0);
  for (const r of (byDow.data ?? []) as { dow: number; visits: number }[]) dow[r.dow] = Number(r.visits);
  const dowData = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: DAYS[d].slice(0, 3), value: dow[d] }));
  const days = (byDay.data ?? []) as { day: string; visits: number; unique_members: number }[];
  const totalVisits = days.reduce((s, d) => s + Number(d.visits), 0);
  const spanDays = daysBetween(from, to < today ? to : today) + 1;

  return (
    <>
      <PageHeader title="Reports" description={`${fmtDate(from)} - ${fmtDate(to)}`} />

      <div className="mb-2 flex flex-wrap gap-2">
        {PRESETS(today).map((p) => (
          <Link key={p.label} href={`/reports?from=${p.from}&to=${p.to}`} className={`btn-sm ${p.from === from && p.to === to ? "btn-primary" : "btn-secondary"}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <DateRangeFilter action="/reports" from={from} to={to} />

      {firstError && (
        <p className="mb-6 rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">
          Some report data failed to load: {firstError.message}. Make sure the latest <code>supabase/schema.sql</code> has been run.
        </p>
      )}

      {/* Profit & loss */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat
          label="Membership & fees"
          value={money(totalPayments, currency)}
          hint={refundsInRange > 0 ? `After ${money(refundsInRange, currency)} refunds` : undefined}
        />
        <Stat label="POS sales" value={money(totalSales, currency)} />
        <Stat label="Total revenue" value={money(revenue, currency)} tone="brand" />
        <Stat label="Expenses" value={money(expenses, currency)} />
        <Stat
          label="Net profit"
          value={money(profit, currency)}
          hint={revenue ? `${Math.round((profit / revenue) * 100)}% margin` : undefined}
          tone={profit >= 0 ? "good" : "bad"}
        />
      </div>

      <Card title="Revenue vs expenses by month" className="mb-6">
        {finance.length ? <RevenueExpenseChart data={finance.map((r) => ({ month: monthLabel(r.month), revenue: Number(r.payments) + Number(r.sales), expenses: Number(r.expenses) }))} currency={currency} /> : <Empty>No data.</Empty>}
        {finance.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted">Show table</summary>
            <TableWrap>
              <table className="tbl mt-2">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Payments</th>
                    <th className="num">POS sales</th>
                    <th className="num">Expenses</th>
                    <th className="num">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {finance.map((r) => {
                    const net = Number(r.payments) + Number(r.sales) - Number(r.expenses);
                    return (
                      <tr key={r.month}>
                        <td>{monthLabel(r.month)}</td>
                        <td className="num">{money(r.payments, currency)}</td>
                        <td className="num">{money(r.sales, currency)}</td>
                        <td className="num">{money(r.expenses, currency)}</td>
                        <td className={`num font-medium ${net < 0 ? "text-bad" : "text-ink"}`}>{money(net, currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </details>
        )}
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Revenue by payment method">
          {byMethod.length ? <SimpleBarChart data={byMethod} name="Revenue" format="money" currency={currency} horizontal height={Math.max(150, byMethod.length * 36)} /> : <Empty>No revenue.</Empty>}
        </Card>
        <Card title="Revenue by category">
          {byCategory.length ? <SimpleBarChart data={byCategory} name="Revenue" format="money" currency={currency} horizontal height={Math.max(150, byCategory.length * 36)} /> : <Empty>No revenue.</Empty>}
        </Card>
        <Card title="Expenses by category">
          {expCats.length ? <SimpleBarChart data={expCats} name="Spent" format="money" currency={currency} horizontal height={Math.max(150, expCats.length * 36)} /> : <Empty>No expenses.</Empty>}
        </Card>
      </div>

      {/* Membership */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Membership</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="New members" value={newMembers} />
        <Stat label="Memberships sold" value={planRows.reduce((s, p) => s + Number(p.sold), 0)} hint="By start date" />
        <Stat label="Lapsed (not renewed)" value={lapsed.count ?? 0} hint="Latest plan ended in range" tone="warn" href="/members?filter=expired" />
        <Stat label="Avg. membership value" value={money(planRows.reduce((s, p) => s + Number(p.revenue), 0) / Math.max(1, planRows.reduce((s, p) => s + Number(p.sold), 0)), currency)} />
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="New members per month">
          {joinedRows.length ? <SimpleBarChart data={joinedRows} name="New members" /> : <Empty>No data.</Empty>}
        </Card>
        <Card title="Plan performance" bodyClass="">
          {!planRows.length ? (
            <Empty>No memberships sold in this period.</Empty>
          ) : (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th className="num">Sold</th>
                    <th className="num">Value</th>
                    <th className="num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sum = planRows.reduce((s, p) => s + Number(p.revenue), 0) || 1;
                    return planRows.map((p) => (
                      <tr key={p.plan_name}>
                        <td className="font-medium text-ink">{p.plan_name}</td>
                        <td className="num">{p.sold}</td>
                        <td className="num">{money(p.revenue, currency)}</td>
                        <td className="num">{Math.round((Number(p.revenue) / sum) * 100)}%</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      {/* Attendance */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Attendance</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Total visits" value={totalVisits} />
        <Stat label="Avg. visits per day" value={(totalVisits / Math.max(1, spanDays)).toFixed(1)} />
        <Stat label="Busiest day" value={totalVisits ? dowData.reduce((a, b) => (b.value > a.value ? b : a)).label : "-"} />
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Visits by weekday">
          {totalVisits ? <SimpleBarChart data={dowData} name="Visits" /> : <Empty>No visits.</Empty>}
        </Card>
        <Card title="Visits by hour of day">
          {hourData.length ? <SimpleBarChart data={hourData} name="Visits" /> : <Empty>No visits.</Empty>}
        </Card>
      </div>

      {/* POS */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Product sales</h2>
      <Card bodyClass="">
        {!productRows.length ? (
          <Empty>No product sales in this period.</Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Units</th>
                  <th className="num">Revenue</th>
                  <th className="num">Gross profit</th>
                </tr>
              </thead>
              <tbody>
                {productRows.map((p) => (
                  <tr key={p.product_name}>
                    <td className="font-medium text-ink">{p.product_name}</td>
                    <td className="num">{p.quantity}</td>
                    <td className="num">{money(p.revenue, currency)}</td>
                    <td className="num">{money(p.profit, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
