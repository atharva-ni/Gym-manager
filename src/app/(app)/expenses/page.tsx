import { Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { fmtDate, money, todayISO } from "@/lib/format";
import { EXPENSE_CATEGORIES, label, options, PAYMENT_METHODS } from "@/lib/constants";
import { rangeParams } from "@/lib/queries";
import type { Expense } from "@/lib/types";
import { Card, Empty, PageHeader, Stat, TableWrap } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { DateRangeFilter } from "@/components/date-range";
import { SimpleBarChart } from "@/components/charts";
import { deleteRecord } from "@/app/actions";
import { saveExpense } from "./actions";

export const metadata = { title: "Expenses · SetFit Fitness" };

function ExpenseFields({ e, today }: { e?: Expense; today: string }) {
  return (
    <>
      <Hidden name="id" value={e?.id} />
      <Grid>
        <SelectField label="Category" name="category" defaultValue={e?.category ?? "utilities"} options={options(EXPENSE_CATEGORIES)} />
        <Field label="Amount" name="amount" type="number" step="0.01" min={0.01} defaultValue={e?.amount} required />
        <Field label="Date" name="spent_on" type="date" defaultValue={e?.spent_on ?? today} required />
        <SelectField label="Paid via" name="method" defaultValue={e?.method ?? "cash"} options={options(PAYMENT_METHODS)} />
      </Grid>
      <Field label="Vendor / payee" name="vendor" defaultValue={e?.vendor ?? ""} />
      <TextArea label="Description" name="description" rows={2} defaultValue={e?.description} />
    </>
  );
}

export default async function ExpensesPage(props: PageProps<"/expenses">) {
  const sp = await props.searchParams;
  const settings = await getSettings();
  const { currency } = settings;
  const today = todayISO(settings.timezone);
  const { from, to } = rangeParams(sp, today);
  const category = typeof sp.category === "string" ? sp.category : "";

  const sb = await createClient();
  let q = sb
    .from("expenses")
    .select("*", { count: "exact" })
    .gte("spent_on", from)
    .lte("spent_on", to)
    .order("spent_on", { ascending: false })
    .limit(1000);
  if (category) q = q.eq("category", category);
  const [{ data, count }, { data: breakdown }] = await Promise.all([
    q,
    sb.rpc("expense_breakdown", { p_from: from, p_to: to }),
  ]);
  const expenses = (data ?? []) as Expense[];
  const cats = ((breakdown ?? []) as { category: string; total: number }[]).map((b) => ({
    label: label(b.category),
    value: Number(b.total),
  }));
  const total = cats.reduce((s, c) => s + c.value, 0);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Rent, salaries, utilities, repairs and everything else going out."
        actions={
          <FormDialog title="Add expense" trigger={<><Plus size={16} /> Add expense</>} action={saveExpense}>
            <ExpenseFields today={today} />
          </FormDialog>
        }
      />

      <DateRangeFilter action="/expenses" from={from} to={to}>
        <label>
          <span className="label">Category</span>
          <select name="category" defaultValue={category} className="input w-auto">
            <option value="">All</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{label(c)}</option>
            ))}
          </select>
        </label>
      </DateRangeFilter>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="grid gap-4">
          <Stat label="Total spent in range" value={money(total, currency)} hint={`${fmtDate(from)} - ${fmtDate(to)}`} />
          <Stat label="Largest category" value={cats[0]?.label ?? "-"} hint={cats[0] ? money(cats[0].value, currency) : undefined} />
        </div>
        <Card title="By category" className="lg:col-span-2">
          {cats.length ? (
            <SimpleBarChart data={cats} name="Spent" format="money" currency={currency} horizontal height={Math.max(160, cats.length * 36)} />
          ) : (
            <Empty>No expenses in this period.</Empty>
          )}
        </Card>
      </div>

      {(count ?? 0) > expenses.length && (
        <p className="mb-3 text-sm text-warn">Showing the latest {expenses.length} of {count}. Narrow the date range to see the rest.</p>
      )}
      <Card bodyClass="">
        {!expenses.length ? (
          <Empty>No expenses recorded.</Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th>Description</th>
                  <th>Method</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.spent_on)}</td>
                    <td>{label(e.category)}</td>
                    <td>{e.vendor ?? "-"}</td>
                    <td className="max-w-xs truncate">{e.description ?? "-"}</td>
                    <td>{label(e.method)}</td>
                    <td className="num font-medium text-ink">{money(e.amount, currency)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <FormDialog title="Edit expense" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={saveExpense}>
                          <ExpenseFields e={e} today={today} />
                        </FormDialog>
                        <ActionButton action={deleteRecord.bind(null, "expenses", e.id)} confirmLabel="Delete expense" confirmText={`Delete the ${money(e.amount, currency)} ${label(e.category).toLowerCase()} expense from ${fmtDate(e.spent_on)}?`} successMessage="Expense deleted">
                          <Trash2 size={14} />
                        </ActionButton>
                      </div>
                    </td>
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
