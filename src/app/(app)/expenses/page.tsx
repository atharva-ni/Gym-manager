import { FileText, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { fmtDate, money, todayISO } from "@/lib/format";
import { EXPENSE_CATEGORIES, label, options, PAYMENT_METHODS } from "@/lib/constants";
import { rangeParams } from "@/lib/queries";
import type { Expense, RecurringExpense } from "@/lib/types";
import { Badge, Card, Empty, PageHeader, Stat, TableWrap } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Checkbox, Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { DateRangeFilter } from "@/components/date-range";
import { SimpleBarChart } from "@/components/charts";
import { deleteRecord } from "@/app/actions";
import { postRecurringExpenses, saveExpense, saveRecurringExpense } from "./actions";

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
      <label className="block">
        <span className="label">Bill photo or PDF{e?.bill_path ? " (replaces the current one)" : ""}</span>
        <input
          type="file"
          name="bill"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          capture="environment"
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-sm"
        />
        <span className="mt-1 block text-xs text-muted">Optional, up to 5 MB. On a phone this can open the camera.</span>
      </label>
    </>
  );
}

function RecurringFields({ r, trainers }: { r?: RecurringExpense; trainers: { id: string; full_name: string }[] }) {
  return (
    <>
      <Hidden name="id" value={r?.id} />
      <Grid>
        <SelectField label="Category" name="category" defaultValue={r?.category ?? "rent"} options={options(EXPENSE_CATEGORIES)} />
        <Field label="Amount" name="amount" type="number" step="0.01" min={0.01} defaultValue={r?.amount} required />
        <Field label="Day of month" name="day_of_month" type="number" min={1} max={28} defaultValue={r?.day_of_month ?? 1} required hint="1 to 28" />
        <SelectField label="Paid via" name="method" defaultValue={r?.method ?? "bank"} options={options(PAYMENT_METHODS)} />
        <Field label="Description" name="description" defaultValue={r?.description ?? ""} placeholder="Rent, Internet, Electricity" required />
        <Field label="Vendor / payee" name="vendor" defaultValue={r?.vendor ?? ""} />
        <SelectField
          label="Staff member (salaries)"
          name="trainer_id"
          placeholder="None"
          defaultValue={r?.trainer_id}
          options={trainers.map((t) => ({ value: t.id, label: t.full_name }))}
        />
      </Grid>
      <Checkbox label="Active" name="is_active" defaultChecked={r?.is_active ?? true} />
    </>
  );
}

export default async function ExpensesPage(props: PageProps<"/expenses">) {
  const sp = await props.searchParams;
  const settings = await getSettings();
  const { currency } = settings;
  const today = todayISO(settings.timezone);
  const monthStartIso = `${today.slice(0, 7)}-01`;
  const dayOfMonth = Number(today.slice(8, 10));
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
  const [{ data, count }, { data: breakdown }, { data: recurringRows }, { data: trainers }] = await Promise.all([
    q,
    sb.rpc("expense_breakdown", { p_from: from, p_to: to }),
    sb.from("recurring_expenses").select("*").order("day_of_month"),
    sb.from("trainers").select("id, full_name").eq("status", "active").order("full_name"),
  ]);
  const expenses = (data ?? []) as Expense[];
  const recurring = (recurringRows ?? []) as RecurringExpense[];
  const dueRecurring = recurring.filter(
    (r) => r.is_active && r.day_of_month <= dayOfMonth && (!r.last_posted || r.last_posted < monthStartIso),
  );
  const cats = ((breakdown ?? []) as { category: string; total: number }[]).map((b) => ({
    label: label(b.category),
    value: Number(b.total),
  }));
  const total = cats.reduce((s, c) => s + c.value, 0);

  // Short-lived private links to bill photos
  const paths = expenses.map((e) => e.bill_path).filter(Boolean) as string[];
  const signed = paths.length ? (await sb.storage.from("bills").createSignedUrls(paths, 3600)).data ?? [] : [];
  const billUrl = new Map(signed.filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Rent, salaries, utilities, repairs and everything else going out."
        actions={
          <FormDialog title="Add expense" trigger={<><Plus size={16} /> Add expense</>} action={saveExpense} successMessage="Expense saved">
            <ExpenseFields today={today} />
          </FormDialog>
        }
      />

      {dueRecurring.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <span>
            <span className="font-semibold">{dueRecurring.length} recurring expense{dueRecurring.length === 1 ? "" : "s"} due this month</span>
            {": "}
            {dueRecurring.map((r) => `${r.description ?? label(r.category)} ${money(r.amount, currency)}`).join(", ")}
          </span>
          <ActionButton action={postRecurringExpenses} className="btn-primary btn-sm" confirmLabel="Add recurring expenses" confirmText="Add this month's due recurring expenses to the list?">
            Add them
          </ActionButton>
        </div>
      )}

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
      <Card bodyClass="" className="mb-6">
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
                        {e.bill_path && billUrl.get(e.bill_path) && (
                          <a href={billUrl.get(e.bill_path)!} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" title="View bill">
                            <FileText size={14} />
                          </a>
                        )}
                        <FormDialog title="Edit expense" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={saveExpense} successMessage="Expense updated">
                          <ExpenseFields e={e} today={today} />
                        </FormDialog>
                        <ActionButton
                          action={deleteRecord.bind(null, "expenses", e.id)}
                          confirmLabel="Delete expense"
                          confirmText={`Delete the ${money(e.amount, currency)} ${label(e.category).toLowerCase()} expense from ${fmtDate(e.spent_on)}?`}
                          successMessage="Expense deleted"
                        >
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

      <Card
        bodyClass=""
        title={
          <span className="flex items-center gap-2">
            <Repeat size={14} /> Recurring expenses
          </span>
        }
        action={
          <FormDialog title="New recurring expense" trigger={<><Plus size={14} /> Recurring</>} triggerClass="btn-secondary btn-sm" action={saveRecurringExpense} successMessage="Recurring expense saved">
            <RecurringFields trainers={trainers ?? []} />
          </FormDialog>
        }
      >
        {!recurring.length ? (
          <Empty>Add rent, salaries, internet and other fixed monthly costs once. Each month the page offers to add them for you.</Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Day</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recurring.map((r) => (
                  <tr key={r.id} className={r.is_active ? "" : "opacity-60"}>
                    <td className="font-medium text-ink">
                      {r.description ?? label(r.category)}
                      {r.vendor && <span className="block text-xs font-normal text-muted">{r.vendor}</span>}
                    </td>
                    <td>{label(r.category)}</td>
                    <td>{r.day_of_month}</td>
                    <td className="num">{money(r.amount, currency)}</td>
                    <td>
                      {!r.is_active ? (
                        <Badge>Paused</Badge>
                      ) : r.last_posted && r.last_posted >= monthStartIso ? (
                        <Badge tone="good">Added this month</Badge>
                      ) : r.day_of_month <= dayOfMonth ? (
                        <Badge tone="warn">Due</Badge>
                      ) : (
                        <Badge>On the {r.day_of_month}</Badge>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <FormDialog title="Edit recurring expense" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={saveRecurringExpense}>
                          <RecurringFields r={r} trainers={trainers ?? []} />
                        </FormDialog>
                        <ActionButton
                          action={deleteRecord.bind(null, "recurring_expenses", r.id)}
                          confirmLabel="Delete recurring expense"
                          confirmText={`Stop adding "${r.description ?? label(r.category)}" every month? Expenses already added stay.`}
                          successMessage="Deleted"
                        >
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
