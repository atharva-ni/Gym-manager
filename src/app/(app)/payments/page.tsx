import Link from "next/link";
import { CalendarPlus, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { addDays, fmtDate, money, todayISO } from "@/lib/format";
import { daysLeftText } from "@/lib/member-state";
import { label, PAYMENT_CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import { getMemberOptions, getPendingFees, rangeParams } from "@/lib/queries";
import { waLink } from "@/lib/whatsapp";
import type { Payment, Plan } from "@/lib/types";
import { Badge, Card, Empty, PageHeader, Stat, TableWrap, Tabs } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { CollectFeeFields } from "@/components/collect-fee";
import { BillFields } from "@/components/bill-fields";
import { renewMembership } from "../members/actions";
import { DateRangeFilter } from "@/components/date-range";
import { deleteRecord } from "@/app/actions";
import { collectPayment, updatePayment } from "./actions";
import { PaymentEditFields } from "./payment-fields";

export const metadata = { title: "Fees & Payments · SetFit Fitness" };

export default async function PaymentsPage(props: PageProps<"/payments">) {
  const sp = await props.searchParams;
  const tab = sp.tab === "dues" || sp.tab === "expiring" ? sp.tab : "collections";
  const settings = await getSettings();
  const { currency } = settings;
  const today = todayISO(settings.timezone);
  const { from, to } = rangeParams(sp, today);
  const method = typeof sp.method === "string" && sp.method ? sp.method : "";
  const category = typeof sp.category === "string" && sp.category ? sp.category : "";

  const sb = await createClient();
  let query = sb
    .from("payments")
    .select("*, members(full_name, member_code)", { count: "exact" })
    .gte("paid_on", from)
    .lte("paid_on", to)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (method) query = query.eq("method", method);
  if (category) query = query.eq("category", category);

  const soon = addDays(today, settings.expiry_alert_days);
  const [{ data, count }, members, fees, { data: expiringRows }] = await Promise.all([
    query,
    getMemberOptions(sb),
    getPendingFees(sb),
    // Latest gym membership or active PT package ending soon (renewed ones end later, so drop out)
    sb
      .from("member_overview")
      .select("id, full_name, member_code, phone, trainer_id, plan_name, membership_end, pt_plan_name, pt_end, pt_trainer_name, balance_due")
      .neq("status", "inactive")
      .or(`and(membership_end.gte.${today},membership_end.lte.${soon}),and(pt_end.gte.${today},pt_end.lte.${soon})`)
      .limit(500),
  ]);
  const payments = (data ?? []) as Payment[];

  type ExpiringRow = {
    id: string;
    full_name: string;
    member_code: string;
    phone: string | null;
    trainer_id: string | null;
    plan_name: string | null;
    membership_end: string | null;
    pt_plan_name: string | null;
    pt_end: string | null;
    pt_trainer_name: string | null;
    balance_due: number;
  };
  const expiring = ((expiringRows ?? []) as ExpiringRow[])
    .flatMap((m) => {
      const rows: { m: ExpiringRow; kind: "membership" | "personal_training"; plan: string; end: string }[] = [];
      if (m.membership_end && m.membership_end >= today && m.membership_end <= soon && m.plan_name) {
        rows.push({ m, kind: "membership", plan: m.plan_name, end: m.membership_end });
      }
      if (m.pt_end && m.pt_end >= today && m.pt_end <= soon && m.pt_plan_name) {
        rows.push({ m, kind: "personal_training", plan: m.pt_plan_name, end: m.pt_end });
      }
      return rows;
    })
    .sort((a, b) => a.end.localeCompare(b.end));

  // Plans and trainers for the inline Renew dialog
  const [{ data: planRows }, { data: trainerRows }] =
    tab === "expiring" && expiring.length
      ? await Promise.all([
          sb.from("plans").select("*").eq("is_active", true).order("price"),
          sb.from("trainers").select("id, full_name").eq("status", "active").order("full_name"),
        ])
      : [{ data: [] }, { data: [] }];
  const activePlans = (planRows ?? []) as Plan[];
  const gymPlans = activePlans.filter((p) => p.kind !== "personal_training");
  const ptPlans = activePlans.filter((p) => p.kind === "personal_training");
  const trainers = trainerRows ?? [];

  // Member details for the dues list
  const dueMemberIds = [...new Set(fees.map((f) => f.member_id))];
  const { data: dueMembers } = dueMemberIds.length
    ? await sb.from("members").select("id, full_name, member_code, phone").in("id", dueMemberIds)
    : { data: [] };
  const memberById = new Map((dueMembers ?? []).map((m) => [m.id, m]));
  const dues = [...fees].sort((a, b) => (a.balance_due_on ?? "9999").localeCompare(b.balance_due_on ?? "9999"));

  const total = payments.reduce((s, p) => s + Number(p.amount), 0);
  const byMethod = new Map<string, number>();
  for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount));
  const topMethod = [...byMethod.entries()].sort((a, b) => b[1] - a[1])[0];
  const outstanding = fees.reduce((s, f) => s + f.balance, 0);
  const overdue = fees.filter((f) => f.balance_due_on && f.balance_due_on < today);

  return (
    <>
      <PageHeader
        title="Fees & Payments"
        description="Every payment belongs to a member and is applied to their membership or PT fee. Part payments leave a balance you can collect later."
        actions={
          <FormDialog title="Collect fee" trigger={<><Plus size={16} /> Collect fee</>} action={collectPayment} submitLabel="Save payment" successMessage="Payment saved">
            <CollectFeeFields members={members} fees={fees} currency={currency} today={today} />
          </FormDialog>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Collected in range" value={money(total, currency)} hint={`${payments.length} payments`} />
        <Stat
          label={topMethod ? `Via ${label(topMethod[0])}` : "Top method"}
          value={topMethod ? money(topMethod[1], currency) : "-"}
          hint={topMethod && total ? `${Math.round((topMethod[1] / total) * 100)}% of collections` : undefined}
        />
        <Stat label="Pending dues" value={money(outstanding, currency)} hint={`${dueMemberIds.length} members`} tone="warn" href="/payments?tab=dues" />
        <Stat label="Overdue" value={overdue.length} hint="Past the promised date" tone={overdue.length ? "bad" : "neutral"} href="/payments?tab=dues" />
      </div>

      <Tabs
        current={tab}
        items={[
          { key: "collections", label: "Collections", href: "/payments" },
          { key: "dues", label: `Pending dues (${fees.length})`, href: "/payments?tab=dues" },
          { key: "expiring", label: `Expiring soon (${expiring.length})`, href: "/payments?tab=expiring" },
        ]}
      />

      {tab === "expiring" ? (
        <Card
          bodyClass=""
          title={`Ending in the next ${settings.expiry_alert_days} days and not renewed yet`}
          action={<Link href="/settings" className="text-xs text-brand">Change window</Link>}
        >
          {!expiring.length ? (
            <Empty>Nothing is expiring in the next {settings.expiry_alert_days} days.</Empty>
          ) : (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Plan</th>
                    <th>Ends</th>
                    <th className="num">Pending dues</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {expiring.map(({ m, kind, plan, end }) => {
                    const isPT = kind === "personal_training";
                    const wa = waLink(
                      m.phone,
                      `Hi ${m.full_name}, your ${isPT ? "personal training package" : "membership"} (${plan}) at ${settings.gym_name} ends on ${fmtDate(end)}. Renew now to keep training without a break. See you at the gym!`,
                    );
                    const startFrom = addDays(end, 1);
                    return (
                      <tr key={`${m.id}-${kind}`}>
                        <td>
                          <Link href={`/members/${m.id}`} className="font-medium text-ink hover:text-brand">
                            {m.full_name}
                          </Link>
                          <p className="text-xs text-muted">{m.member_code}{m.phone ? ` · ${m.phone}` : ""}</p>
                        </td>
                        <td>
                          {isPT && <Badge tone="brand">PT</Badge>} {plan}
                          {isPT && m.pt_trainer_name && <p className="text-xs text-muted">{m.pt_trainer_name}</p>}
                        </td>
                        <td>
                          <Badge tone={end === today ? "bad" : "warn"}>{daysLeftText(end, today)}</Badge>
                          <p className="mt-0.5 text-xs text-muted">{fmtDate(end)}</p>
                        </td>
                        <td className={`num ${Number(m.balance_due) > 0 ? "font-medium text-bad" : "text-muted"}`}>
                          {Number(m.balance_due) > 0 ? money(m.balance_due, currency) : "-"}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {wa && (
                              <a href={wa} target="_blank" rel="noreferrer" className="btn-ghost btn-sm text-good" title="Send renewal reminder on WhatsApp">
                                <MessageCircle size={14} /> Remind
                              </a>
                            )}
                            <FormDialog
                              title={`${isPT ? "Renew PT" : "Renew"}: ${m.full_name}`}
                              trigger={<><CalendarPlus size={14} /> Renew</>}
                              triggerClass="btn-secondary btn-sm"
                              action={renewMembership.bind(null, m.id)}
                              submitLabel="Save bill"
                              successMessage="Renewed"
                              wide
                            >
                              {(isPT ? ptPlans.length && trainers.length : gymPlans.length) ? (
                                <BillFields
                                  ptOnly={isPT}
                                  plans={isPT ? [] : gymPlans}
                                  ptPlans={trainers.length ? ptPlans : []}
                                  trainers={trainers}
                                  currency={currency}
                                  today={today}
                                  startDate={startFrom}
                                  ptStartDate={startFrom}
                                  defaultTrainerId={m.trainer_id}
                                  chargeAdmission={false}
                                />
                              ) : (
                                <p className="text-sm text-muted">
                                  {isPT ? "No active PT packages or trainers." : "No active membership plans."} Set them up on the{" "}
                                  <Link href={isPT && ptPlans.length ? "/trainers" : "/plans"} className="text-brand underline">
                                    {isPT && ptPlans.length ? "Staff" : "Plans"} page
                                  </Link>
                                  .
                                </p>
                              )}
                            </FormDialog>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ) : tab === "dues" ? (
        <Card bodyClass="">
          {!dues.length ? (
            <Empty>No pending dues. Every member is fully paid.</Empty>
          ) : (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Plan</th>
                    <th className="num">Balance</th>
                    <th>Due by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dues.map((f) => {
                    const m = memberById.get(f.member_id);
                    const wa = waLink(
                      m?.phone,
                      `Hi ${m?.full_name ?? ""}, a gentle reminder from ${settings.gym_name}: ${money(f.balance, currency)} is pending for your ${f.plan_name}${
                        f.balance_due_on ? `, due on ${fmtDate(f.balance_due_on)}` : ""
                      }. You can pay at the front desk or by UPI. Thank you!`,
                    );
                    return (
                      <tr key={f.id}>
                        <td>
                          <Link href={`/members/${f.member_id}`} className="font-medium text-ink hover:text-brand">
                            {m?.full_name ?? "Member"}
                          </Link>
                          <p className="text-xs text-muted">{m?.member_code}{m?.phone ? ` · ${m.phone}` : ""}</p>
                        </td>
                        <td>
                          {f.kind === "personal_training" && <Badge tone="brand">PT</Badge>} {f.plan_name}
                          <p className="text-xs text-muted">{fmtDate(f.start_date)} to {fmtDate(f.end_date)}</p>
                        </td>
                        <td className="num font-semibold text-bad">{money(f.balance, currency)}</td>
                        <td>
                          {!f.balance_due_on ? (
                            <span className="text-muted">Not set</span>
                          ) : f.balance_due_on < today ? (
                            <Badge tone="bad">Overdue · {fmtDate(f.balance_due_on)}</Badge>
                          ) : f.balance_due_on === today ? (
                            <Badge tone="warn">Today</Badge>
                          ) : (
                            fmtDate(f.balance_due_on)
                          )}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {wa && (
                              <a href={wa} target="_blank" rel="noreferrer" className="btn-ghost btn-sm text-good" title="Send WhatsApp reminder">
                                <MessageCircle size={14} /> Remind
                              </a>
                            )}
                            <FormDialog title={`Collect fee: ${m?.full_name ?? ""}`} trigger="Collect" triggerClass="btn-secondary btn-sm" action={collectPayment} submitLabel="Save payment" successMessage="Payment saved">
                              <CollectFeeFields
                                memberId={f.member_id}
                                fees={fees.filter((x) => x.member_id === f.member_id)}
                                defaultFeeId={f.id}
                                currency={currency}
                                today={today}
                              />
                            </FormDialog>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ) : (
        <>
          <DateRangeFilter action="/payments" from={from} to={to}>
            <label>
              <span className="label">Mode</span>
              <select name="method" defaultValue={method} className="input w-auto">
                <option value="">All</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{label(m)}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">For</span>
              <select name="category" defaultValue={category} className="input w-auto">
                <option value="">All</option>
                {PAYMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{label(c)}</option>
                ))}
              </select>
            </label>
          </DateRangeFilter>

          {(count ?? 0) > payments.length && (
            <p className="mb-3 text-sm text-warn">
              Showing the latest {payments.length} of {count} payments. Narrow the date range to see the rest.
            </p>
          )}
          <Card bodyClass="">
            {!payments.length ? (
              <Empty>No payments in this period.</Empty>
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Member</th>
                      <th>For</th>
                      <th>Mode</th>
                      <th>Receipt</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap">{fmtDate(p.paid_on)}</td>
                        <td>
                          <Link href={`/members/${p.member_id}`} className="text-ink hover:text-brand">
                            {p.members?.full_name ?? "Member"} <span className="text-xs text-muted">{p.members?.member_code}</span>
                          </Link>
                        </td>
                        <td>{label(p.category)}</td>
                        <td>{label(p.method)}</td>
                        <td className="text-xs">
                          {p.receipt_no ?? "-"}
                          {p.reference && <span className="block text-muted">Ref {p.reference}</span>}
                        </td>
                        <td className="num font-medium text-ink">{money(p.amount, currency)}</td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <Link href={`/receipt/${p.receipt_no ?? p.id}`} target="_blank" className="btn-ghost btn-sm">
                              Receipt
                            </Link>
                            <FormDialog title="Edit payment" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={updatePayment} successMessage="Payment updated">
                              <PaymentEditFields payment={p} today={today} />
                            </FormDialog>
                            <ActionButton action={deleteRecord.bind(null, "payments", p.id)} confirmLabel="Delete payment" confirmText={`Delete this ${money(p.amount, currency)} payment from ${p.members?.full_name ?? "the member"}? The amount will show as due again.`} successMessage="Payment deleted">
                              <Trash2 size={14} />
                            </ActionButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-right text-sm font-medium text-ink">Total</td>
                      <td className="num px-4 py-3 font-semibold text-ink">{money(total, currency)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </>
  );
}
