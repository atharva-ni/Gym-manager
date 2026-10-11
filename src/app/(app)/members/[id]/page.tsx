import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  ArrowLeft, CalendarPlus, CreditCard, Dumbbell, LogIn, LogOut, MessageCircle, Minus, Pause, Pencil, Play, Plus, Printer, Ruler, Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { addDays, age, dayBoundsUTC, fmtDate, fmtDateTime, money, monthStart, todayISO } from "@/lib/format";
import { daysLeftText, isFrozen, membershipState } from "@/lib/member-state";
import { refundSuggestion } from "@/lib/billing";
import { label, options, PAYMENT_METHODS } from "@/lib/constants";
import { getPendingFees } from "@/lib/queries";
import { waLink } from "@/lib/whatsapp";
import type { Attendance, Freeze, Measurement, MemberOverview, MembershipBalance, Payment, Plan, Refund } from "@/lib/types";
import { Avatar, Badge, Card, Empty, Stat, StatusBadge, TableWrap, Tabs } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Checkbox, Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { TrendLine } from "@/components/charts";
import { CollectFeeFields } from "@/components/collect-fee";
import { BillFields } from "@/components/bill-fields";
import { deleteRecord } from "@/app/actions";
import { checkIn, checkOut } from "../../attendance/actions";
import { collectPayment } from "../../payments/actions";
import { MemberFields } from "../member-fields";
import {
  changePlan, deleteMember, extendMembership, freezeMembership, logSession, refundMembership, renewMembership, saveMeasurement,
  unfreezeMember, unfreezeMembership, updateMember, updateMembership,
} from "../actions";

const TABS = [
  { key: "memberships", label: "Plans & PT" },
  { key: "payments", label: "Payments" },
  { key: "attendance", label: "Attendance" },
  { key: "progress", label: "Progress" },
];

export default async function MemberPage(props: PageProps<"/members/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const tab = typeof sp.tab === "string" && TABS.some((t) => t.key === sp.tab) ? sp.tab : "memberships";

  const settings = await getSettings();
  const { currency, timezone } = settings;
  const today = todayISO(timezone);
  const sb = await createClient();

  const { data: memberRow } = await sb.from("member_overview").select("*").eq("id", id).maybeSingle();
  if (!memberRow) notFound();
  const m = memberRow as MemberOverview;

  const monthBounds = dayBoundsUTC(monthStart(today), timezone, today);
  const [msRes, payRes, attRes, measRes, plansRes, trainersRes, visitsRes, fees, frzRes, refRes] = await Promise.all([
    sb.from("membership_balances").select("*").eq("member_id", id).order("end_date", { ascending: false }),
    sb.from("payments").select("*").eq("member_id", id).order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    sb.from("attendance").select("*").eq("member_id", id).order("check_in", { ascending: false }).limit(60),
    sb.from("measurements").select("*").eq("member_id", id).order("measured_on"),
    sb.from("plans").select("*").eq("is_active", true).order("price"),
    sb.from("trainers").select("id, full_name, status").order("full_name"),
    sb
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("member_id", id)
      .gte("check_in", monthBounds.start)
      .lt("check_in", monthBounds.end),
    getPendingFees(sb, id),
    sb.from("membership_freezes").select("*").eq("member_id", id).order("start_date", { ascending: false }),
    sb.from("refunds").select("*").eq("member_id", id).order("refunded_on", { ascending: false }),
  ]);
  const freezes = (frzRes.data ?? []) as Freeze[];
  const refunds = (refRes.data ?? []) as Refund[];
  const freezesOf = (msId: string) => freezes.filter((f) => f.membership_id === msId);
  const currentFreeze = freezes.find((f) => f.membership_id === m.membership_id && f.start_date <= today && today <= f.end_date);
  const memberships = (msRes.data ?? []) as MembershipBalance[];
  const payments = (payRes.data ?? []) as Payment[];
  const attendance = (attRes.data ?? []) as Attendance[];
  const measurements = (measRes.data ?? []) as Measurement[];
  const plans = (plansRes.data ?? []) as Plan[];
  const gymPlans = plans.filter((p) => p.kind === "membership");
  const ptPlans = plans.filter((p) => p.kind === "personal_training");
  const allTrainers = trainersRes.data ?? [];
  const trainers = allTrainers.filter((t) => t.status === "active");
  const trainerName = new Map(allTrainers.map((t) => [t.id, t.full_name]));

  const state = membershipState(m, today, settings.expiry_alert_days);
  const openVisit = attendance.find((a) => !a.check_out && a.check_in >= dayBoundsUTC(today, timezone).start);
  const renewFrom = m.membership_end && m.membership_end >= today ? addDays(m.membership_end, 1) : today;
  const ptFrom = m.pt_end && m.pt_end >= today ? addDays(m.pt_end, 1) : today;
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0) - refunds.reduce((s, r) => s + Number(r.amount), 0);
  const history = [
    ...payments.map((p) => ({ kind: "payment" as const, date: p.paid_on, p })),
    ...refunds.map((r) => ({ kind: "refund" as const, date: r.refunded_on, r })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const due = Number(m.balance_due);
  const overdue = due > 0 && !!m.next_due_on && m.next_due_on < today;
  const reminder = waLink(
    m.phone,
    `Hi ${m.full_name}, a gentle reminder from ${settings.gym_name}: ${money(due, currency)} of your fee is pending${
      m.next_due_on ? `, due on ${fmtDate(m.next_due_on)}` : ""
    }. You can pay at the front desk or by UPI. Thank you!`,
  );
  const memberAge = age(m.date_of_birth, today);

  const collectDialog = (trigger: ReactNode, triggerClass: string) => (
    <FormDialog title="Collect fee" trigger={trigger} triggerClass={triggerClass} action={collectPayment} submitLabel="Save payment" successMessage="Payment saved">
      <CollectFeeFields memberId={m.id} fees={fees} currency={currency} today={today} />
    </FormDialog>
  );

  return (
    <>
      <Link href="/members" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Members
      </Link>
      {typeof sp.receipt === "string" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-good/30 bg-good-soft px-4 py-3 text-sm text-good">
          <span>Bill saved. Receipt {sp.receipt}.</span>
          <Link href={`/receipt/${sp.receipt}`} target="_blank" className="btn-secondary btn-sm">
            <Printer size={14} /> Print receipt
          </Link>
        </div>
      )}
      {sp.warn === "membership" && (
        <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          The member was saved, but the bill could not be created. Use Renew / add plan to try again.
        </p>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={m.full_name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{m.full_name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>{m.member_code}</span>
              <StatusBadge status={state} />
              {m.pt_plan_name && <Badge tone="brand">PT</Badge>}
              {openVisit && <Badge tone="good">In the gym now</Badge>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {openVisit ? (
            <ActionButton action={checkOut.bind(null, openVisit.id)} className="btn-secondary">
              <LogOut size={16} /> Check out
            </ActionButton>
          ) : (
            <ActionButton action={checkIn.bind(null, m.id)} className="btn-secondary">
              <LogIn size={16} /> Check in
            </ActionButton>
          )}
          <FormDialog
            title="Add personal training"
            trigger={<><Dumbbell size={16} /> Add PT</>}
            triggerClass="btn-secondary"
            action={renewMembership.bind(null, m.id)}
            submitLabel="Save PT bill"
            successMessage="Personal training added"
            wide
          >
            {ptPlans.length && trainers.length ? (
              <BillFields
                ptOnly
                plans={[]}
                ptPlans={ptPlans}
                trainers={trainers}
                currency={currency}
                today={today}
                startDate={today}
                ptStartDate={ptFrom}
                defaultTrainerId={m.trainer_id}
              />
            ) : (
              <p className="text-sm text-muted">
                {ptPlans.length ? (
                  <>Add a trainer on the <Link href="/trainers" className="text-brand underline">Staff page</Link> first.</>
                ) : (
                  <>Create a personal training package on the <Link href="/plans" className="text-brand underline">Plans page</Link> first (e.g. 12 sessions in 30 days).</>
                )}
              </p>
            )}
          </FormDialog>
          <FormDialog
            title="Renew / add plan"
            trigger={<><CalendarPlus size={16} /> Renew / add plan</>}
            action={renewMembership.bind(null, m.id)}
            submitLabel="Save bill"
            successMessage="Bill saved"
            wide
          >
            {gymPlans.length || ptPlans.length ? (
              <BillFields
                plans={gymPlans}
                ptPlans={trainers.length ? ptPlans : []}
                trainers={trainers}
                currency={currency}
                today={today}
                startDate={renewFrom}
                ptStartDate={ptFrom}
                defaultTrainerId={m.trainer_id}
                chargeAdmission={false}
              />
            ) : (
              <p className="text-sm text-muted">
                Create a plan first on the <Link href="/plans" className="text-brand underline">Plans page</Link>.
              </p>
            )}
          </FormDialog>
          <FormDialog title="Edit member" trigger={<Pencil size={16} />} triggerClass="btn-secondary" action={updateMember} successMessage="Member updated" wide>
            <MemberFields member={m} trainers={trainers} today={today} />
          </FormDialog>
        </div>
      </div>

      {/* Frozen bar: a dated freeze, or the old manual "frozen" status */}
      {state === "frozen" && !isFrozen(m, today) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand">
          <span>
            <span className="font-semibold">Marked as frozen</span> (set by hand, with no freeze dates). Unfreeze to make the membership active
            again, or use Freeze on the plan below to pause it with dates.
          </span>
          <ActionButton
            action={unfreezeMember.bind(null, m.id)}
            className="btn-secondary btn-sm"
            confirmLabel="Unfreeze"
            confirmText={`Mark ${m.full_name} and their plans as active again?`}
          >
            <Play size={14} /> Unfreeze
          </ActionButton>
        </div>
      )}
      {isFrozen(m, today) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand">
          <span>
            <span className="font-semibold">Membership frozen</span> until {fmtDate(m.freeze_end)}. It resumes automatically; the end date has
            been moved out by the freeze length.
          </span>
          {currentFreeze && (
            <ActionButton
              action={unfreezeMembership.bind(null, currentFreeze.id)}
              className="btn-secondary btn-sm"
              confirmLabel="Resume membership"
              confirmText="End the freeze today? Unused freeze days are taken back off the end date."
            >
              <Play size={14} /> Resume now
            </ActionButton>
          )}
        </div>
      )}

      {/* Dues bar */}
      {due > 0 && (
        <div
          className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            overdue ? "border-bad/30 bg-bad-soft text-bad" : "border-warn/30 bg-warn-soft text-warn"
          }`}
        >
          <span>
            <span className="font-semibold">{money(due, currency)} pending</span>
            {m.next_due_on && <> · {overdue ? "overdue since" : "due by"} {fmtDate(m.next_due_on)}</>}
          </span>
          <span className="flex flex-wrap gap-2">
            {reminder && (
              <a href={reminder} target="_blank" rel="noreferrer" className="btn-secondary btn-sm text-good">
                <MessageCircle size={14} /> Remind on WhatsApp
              </a>
            )}
            {collectDialog(<><CreditCard size={14} /> Collect fee</>, "btn-primary btn-sm")}
          </span>
        </div>
      )}

      {/* Key numbers */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Current plan" value={m.plan_name ?? "None"} hint={m.membership_start ? `Since ${fmtDate(m.membership_start)}` : "Use Renew / add plan"} />
        <Stat
          label="Expires"
          value={fmtDate(m.membership_end)}
          hint={daysLeftText(m.membership_end, today) || undefined}
          tone={state === "expired" ? "bad" : state === "expiring" ? "warn" : "neutral"}
        />
        <Stat
          label="Personal training"
          value={m.pt_plan_name ?? "None"}
          hint={m.pt_plan_name ? `${m.pt_trainer_name ?? "Trainer"} · until ${fmtDate(m.pt_end)}` : "Use Add PT"}
        />
        <Stat
          label="Visits this month"
          value={visitsRes.count ?? 0}
          hint={m.last_visit ? `Last ${fmtDateTime(m.last_visit, timezone)}` : "No visits yet"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile */}
        <Card title="Profile" className="h-fit">
          <dl className="space-y-3 text-sm">
            {[
              ["Mobile", m.phone],
              ["Email", m.email],
              ["Gender", m.gender && label(m.gender)],
              ["Date of birth", m.date_of_birth && `${fmtDate(m.date_of_birth)}${memberAge !== null ? ` (${memberAge} yrs)` : ""}`],
              ["Joined", fmtDate(m.joined_on)],
              ["Floor trainer", m.trainer_name],
              ["Account", label(m.status)],
              ["Lifetime paid", money(totalPaid, currency)],
              ["Address", m.address],
              ["Emergency contact", [m.emergency_name, m.emergency_phone].filter(Boolean).join(" · ")],
            ].map(([k, v]) => (
              <div key={k as string} className="grid grid-cols-[120px_1fr] gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="break-words text-ink">{v || "-"}</dd>
              </div>
            ))}
          </dl>
          {m.medical_notes && (
            <div className="mt-4 rounded-lg bg-warn-soft p-3 text-sm text-warn">
              <p className="font-medium">Medical notes</p>
              <p className="mt-1 whitespace-pre-line">{m.medical_notes}</p>
            </div>
          )}
          {m.notes && <p className="mt-4 whitespace-pre-line text-sm text-ink-2">{m.notes}</p>}
          <div className="mt-5 border-t border-line pt-4">
            <ActionButton
              action={deleteMember.bind(null, m.id)}
              className="btn-danger btn-sm"
              confirmLabel="Delete member"
              confirmText={`Permanently delete ${m.full_name}? This only works if they have no payments. Otherwise edit them and set Status to Inactive.`}
              title="Delete member"
            >
              <Trash2 size={14} /> Delete member
            </ActionButton>
          </div>
        </Card>

        <div className="min-w-0 lg:col-span-2">
          <Tabs current={tab} items={TABS.map((t) => ({ ...t, href: `/members/${m.id}?tab=${t.key}` }))} />

          {tab === "memberships" && (
            <Card bodyClass="">
              {!memberships.length ? (
                <Empty>No memberships or PT packages yet. Use Renew / add plan or Add PT above.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {memberships.map((x) => {
                    const isPT = x.kind === "personal_training";
                    const s =
                      x.status !== "active" ? x.status : x.end_date < today ? "expired" : x.start_date > today ? "upcoming" : "active";
                    const net = Number(x.price) - Number(x.discount);
                    const owes = Number(x.balance) > 0;
                    const sessionsLeft = x.sessions_total ? x.sessions_total - x.sessions_used : null;
                    const canLog = isPT && s === "active" && (sessionsLeft === null || sessionsLeft > 0);
                    return (
                      <li key={x.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                            {isPT && <Badge tone="brand">PT</Badge>}
                            {x.plan_name}
                            <StatusBadge status={s} />
                          </p>
                          <p className="text-sm text-ink-2">
                            {fmtDate(x.start_date)} to {fmtDate(x.end_date)}
                            {isPT && <> · {x.trainer_id ? (trainerName.get(x.trainer_id) ?? "Trainer") : "No trainer"}</>}
                          </p>
                          {isPT && (
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="text-ink-2">
                                Sessions <span className="font-medium text-ink">{x.sessions_used}</span>
                                {x.sessions_total ? ` of ${x.sessions_total}` : ""}
                              </span>
                              {x.sessions_used > 0 && s === "active" && (
                                <ActionButton action={logSession.bind(null, x.id, -1)} className="btn-ghost btn-sm px-1.5" title="Undo last session">
                                  <Minus size={12} />
                                </ActionButton>
                              )}
                              {canLog && (
                                <ActionButton action={logSession.bind(null, x.id, 1)} className="btn-secondary btn-sm" title="Log a session" successMessage="Session logged">
                                  <Plus size={12} /> Session
                                </ActionButton>
                              )}
                            </div>
                          )}
                          {freezesOf(x.id).map((f) => {
                            const live = f.end_date >= today;
                            return (
                              <div key={f.id} className="flex flex-wrap items-center gap-2 text-xs">
                                <Badge tone={live ? "brand" : "neutral"}>
                                  <Pause size={10} className="mr-1" /> {f.start_date > today ? "Freeze planned" : live ? "Frozen" : "Was frozen"}
                                </Badge>
                                <span className="text-muted">
                                  {fmtDate(f.start_date)} to {fmtDate(f.end_date)} ({f.days}d){f.reason ? ` · ${f.reason}` : ""}
                                </span>
                                {live && (
                                  <ActionButton
                                    action={unfreezeMembership.bind(null, f.id)}
                                    className="btn-ghost btn-sm px-1.5"
                                    confirmLabel={f.start_date > today ? "Cancel freeze" : "Resume membership"}
                                    confirmText={
                                      f.start_date > today
                                        ? "Cancel this planned freeze? The end date moves back."
                                        : "End the freeze today? Unused freeze days are taken back off the end date."
                                    }
                                  >
                                    {f.start_date > today ? "Cancel" : "Resume now"}
                                  </ActionButton>
                                )}
                              </div>
                            );
                          })}
                          {Number(x.refunded) > 0 && <p className="text-xs text-bad">Refunded {money(x.refunded, currency)}</p>}
                          {x.notes && <p className="whitespace-pre-line text-xs text-muted">{x.notes}</p>}
                        </div>

                        <div className="flex shrink-0 items-start gap-4 sm:flex-col sm:items-end sm:gap-2">
                          <dl className="grid grid-cols-3 gap-x-4 text-right text-sm tabular-nums">
                            <dt className="text-xs text-muted">Fee</dt>
                            <dt className="text-xs text-muted">Paid</dt>
                            <dt className="text-xs text-muted">Due</dt>
                            <dd className="text-ink">{money(net, currency)}</dd>
                            <dd className="text-ink">{money(x.paid, currency)}</dd>
                            <dd className={owes ? "font-semibold text-bad" : "text-good"}>{owes ? money(x.balance, currency) : "Paid"}</dd>
                          </dl>
                          {owes && x.balance_due_on && (
                            <p className={`text-xs ${x.balance_due_on < today ? "text-bad" : "text-muted"}`}>by {fmtDate(x.balance_due_on)}</p>
                          )}
                          <div className="flex flex-wrap justify-end gap-1">
                            {s !== "cancelled" && x.end_date >= today && x.kind !== "pass" && !freezesOf(x.id).some((f) => f.end_date >= today) && (
                              <FormDialog
                                title={isPT ? "Freeze PT package" : "Freeze membership"}
                                trigger={<><Pause size={12} /> Freeze</>}
                                triggerClass="btn-ghost btn-sm"
                                action={freezeMembership}
                                submitLabel="Freeze"
                              >
                                <Hidden name="id" value={x.id} />
                                <p className="text-sm text-muted">
                                  The plan is paused for the freeze length and its end date ({fmtDate(x.end_date)}) moves out by the same number of days.
                                  It resumes automatically, or use Resume now to end it early.
                                </p>
                                <Grid cols={3}>
                                  <Field label="Freeze from" name="start_date" type="date" min={today} max={x.end_date} defaultValue={today} required />
                                  <Field label="Days" name="days" type="number" min={1} max={365} defaultValue={15} required />
                                  <Field label="Reason" name="reason" placeholder="Travel, injury, exams" />
                                </Grid>
                              </FormDialog>
                            )}
                            {x.kind === "membership" && s === "active" && gymPlans.length > 0 && (
                              <FormDialog
                                title={`Change plan: ${x.plan_name}`}
                                trigger="Change plan"
                                triggerClass="btn-ghost btn-sm"
                                action={changePlan.bind(null, x.id)}
                                submitLabel="Change plan"
                                successMessage="Plan changed"
                                wide
                              >
                                <BillFields
                                  plans={gymPlans.filter((p) => p.id !== x.plan_id)}
                                  ptPlans={[]}
                                  trainers={[]}
                                  currency={currency}
                                  today={today}
                                  startDate={today > x.start_date ? today : x.start_date}
                                  ptStartDate={today}
                                  chargeAdmission={false}
                                  changeFrom={x}
                                />
                              </FormDialog>
                            )}
                            {(Number(x.paid) > 0 || s !== "cancelled") && (
                              <FormDialog
                                title={`Refund / cancel: ${x.plan_name}`}
                                trigger="Refund"
                                triggerClass="btn-ghost btn-sm"
                                action={refundMembership}
                                submitLabel="Save"
                              >
                                <Hidden name="id" value={x.id} />
                                <p className="text-sm text-muted">
                                  Paid {money(x.paid, currency)} on this plan{Number(x.refunded) > 0 ? ` (after ${money(x.refunded, currency)} already refunded)` : ""}. The
                                  suggested refund is the paid share of the unused days.
                                </p>
                                <Grid>
                                  <Field
                                    label="Refund amount"
                                    name="amount"
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    max={Number(x.paid)}
                                    defaultValue={refundSuggestion(x, today)}
                                    hint="Use 0 to cancel without a refund."
                                  />
                                  <SelectField label="Refund mode" name="method" defaultValue="upi" options={options(PAYMENT_METHODS)} />
                                  <Field label="Date" name="refunded_on" type="date" max={today} defaultValue={today} required />
                                  <Field label="Reason" name="reason" placeholder="Moving city, medical, unhappy" />
                                </Grid>
                                {s !== "cancelled" && <Checkbox label="Cancel this plan (stops it and clears any pending balance)" name="cancel" defaultChecked />}
                              </FormDialog>
                            )}
                            <FormDialog
                              title={isPT ? "Extend PT package" : "Extend membership"}
                              trigger="Extend"
                              triggerClass="btn-ghost btn-sm"
                              action={extendMembership}
                              submitLabel="Extend"
                              successMessage="End date extended"
                            >
                              <Hidden name="id" value={x.id} />
                              <p className="text-sm text-muted">
                                Adds days to the end date ({fmtDate(x.end_date)}), e.g. for a freeze, holiday or compensation.
                              </p>
                              <Grid>
                                <Field label="Days to add" name="days" type="number" min={1} defaultValue={7} required />
                                <Field label="Reason" name="reason" placeholder="Freeze: travel" />
                              </Grid>
                            </FormDialog>
                            <FormDialog title={isPT ? "Edit PT package" : "Edit membership"} trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={updateMembership}>
                              <Hidden name="id" value={x.id} />
                              <Hidden name="kind" value={x.kind} />
                              <Grid>
                                <Field label="Start date" name="start_date" type="date" defaultValue={x.start_date} required />
                                <Field label="End date" name="end_date" type="date" defaultValue={x.end_date} required />
                                <Field label="Fee before discount" name="price" type="number" step="0.01" min={0} defaultValue={x.price} required />
                                <Field label="Discount" name="discount" type="number" step="0.01" min={0} defaultValue={x.discount} />
                                <Field label="Balance due by" name="balance_due_on" type="date" defaultValue={x.balance_due_on ?? ""} />
                                <SelectField
                                  label="Status"
                                  name="status"
                                  defaultValue={x.status}
                                  options={[
                                    { value: "active", label: "Active" },
                                    ...(x.status === "frozen" ? [{ value: "frozen", label: "Frozen (old)" }] : []),
                                    { value: "cancelled", label: "Cancelled" },
                                  ]}
                                />
                                {isPT && (
                                  <>
                                    <SelectField
                                      label="Trainer"
                                      name="trainer_id"
                                      defaultValue={x.trainer_id}
                                      options={allTrainers.map((t) => ({ value: t.id, label: t.full_name }))}
                                    />
                                    <Field label="Sessions in package" name="sessions_total" type="number" min={1} defaultValue={x.sessions_total ?? ""} />
                                  </>
                                )}
                              </Grid>
                              <TextArea label="Notes" name="notes" rows={2} defaultValue={x.notes} />
                            </FormDialog>
                            <ActionButton
                              action={deleteRecord.bind(null, "memberships", x.id)}
                              confirmLabel={isPT ? "Delete PT package" : "Delete membership"}
                              confirmText="This only works if no payments were made against it. Otherwise edit it and set Status to Cancelled."
                              successMessage="Deleted"
                            >
                              <Trash2 size={14} />
                            </ActionButton>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          {tab === "payments" && (
            <Card
              bodyClass=""
              title={`${payments.length} payment${payments.length === 1 ? "" : "s"}${refunds.length ? `, ${refunds.length} refund${refunds.length === 1 ? "" : "s"}` : ""} · net ${money(totalPaid, currency)}`}
              action={collectDialog(<><Plus size={14} /> Record payment</>, "btn-secondary btn-sm")}
            >
              {!history.length ? (
                <Empty>No payments recorded.</Empty>
              ) : (
                <TableWrap>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>For</th>
                        <th>Mode</th>
                        <th>Receipt</th>
                        <th className="num">Amount</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) =>
                        h.kind === "refund" ? (
                          <tr key={`r-${h.r.id}`} className="bg-bad-soft/40">
                            <td className="whitespace-nowrap">{fmtDate(h.r.refunded_on)}</td>
                            <td>
                              <Badge tone="bad">Refund</Badge>
                              {h.r.reason && <span className="block text-xs text-muted">{h.r.reason}</span>}
                            </td>
                            <td>{label(h.r.method)}</td>
                            <td className="text-xs">-</td>
                            <td className="num font-medium text-bad">- {money(h.r.amount, currency)}</td>
                            <td />
                          </tr>
                        ) : (
                        <tr key={h.p.id}>
                          <td className="whitespace-nowrap">{fmtDate(h.p.paid_on)}</td>
                          <td>{label(h.p.category)}</td>
                          <td>{label(h.p.method)}</td>
                          <td className="text-xs">{h.p.receipt_no ?? "-"}</td>
                          <td className="num font-medium text-ink">{money(h.p.amount, currency)}</td>
                          <td>
                            <div className="flex justify-end gap-1">
                              <Link href={`/receipt/${h.p.receipt_no ?? h.p.id}`} className="btn-ghost btn-sm" target="_blank" title="Print receipt">
                                <Printer size={14} />
                              </Link>
                              <ActionButton
                                action={deleteRecord.bind(null, "payments", h.p.id)}
                                confirmLabel="Delete payment"
                                confirmText={`Delete this ${money(h.p.amount, currency)} payment? The amount will show as due again.`}
                                successMessage="Payment deleted"
                              >
                                <Trash2 size={14} />
                              </ActionButton>
                            </div>
                          </td>
                        </tr>
                      
                        ),
                      )}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          )}

          {tab === "attendance" && (
            <Card bodyClass="" title={attendance.length ? `Last ${attendance.length} visits` : "Visits"}>
              {!attendance.length ? (
                <Empty>No check-ins yet.</Empty>
              ) : (
                <TableWrap>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Check in</th>
                        <th>Check out</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendance.map((a) => {
                        const mins = a.check_out ? Math.round((Date.parse(a.check_out) - Date.parse(a.check_in)) / 60000) : null;
                        return (
                          <tr key={a.id}>
                            <td>{fmtDateTime(a.check_in, timezone)}</td>
                            <td>{a.check_out ? fmtDateTime(a.check_out, timezone) : "-"}</td>
                            <td>{mins !== null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          )}

          {tab === "progress" && (
            <div className="space-y-6">
              <Card
                title="Body weight"
                action={
                  <FormDialog
                    title="Add measurement"
                    trigger={<><Ruler size={14} /> Add measurement</>}
                    triggerClass="btn-secondary btn-sm"
                    action={saveMeasurement.bind(null, m.id)}
                    successMessage="Measurement saved"
                  >
                    <Field label="Date" name="measured_on" type="date" defaultValue={today} max={today} required />
                    <Grid cols={3}>
                      <Field label="Weight (kg)" name="weight_kg" type="number" step="0.1" min={0} />
                      <Field label="Height (cm)" name="height_cm" type="number" step="0.1" min={0} />
                      <Field label="Body fat %" name="body_fat_pct" type="number" step="0.1" min={0} max={100} />
                      <Field label="Chest (cm)" name="chest_cm" type="number" step="0.1" min={0} />
                      <Field label="Waist (cm)" name="waist_cm" type="number" step="0.1" min={0} />
                      <Field label="Arms (cm)" name="arms_cm" type="number" step="0.1" min={0} />
                    </Grid>
                    <TextArea label="Notes" name="notes" rows={2} />
                  </FormDialog>
                }
              >
                {measurements.filter((x) => x.weight_kg).length >= 2 ? (
                  <TrendLine
                    name="Weight"
                    unit=" kg"
                    data={measurements.filter((x) => x.weight_kg).map((x) => ({ label: fmtDate(x.measured_on), value: Number(x.weight_kg) }))}
                  />
                ) : (
                  <Empty>Add at least two weight measurements to see a trend.</Empty>
                )}
              </Card>
              {measurements.length > 0 && (
                <Card bodyClass="">
                  <TableWrap>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th className="num">Weight</th>
                          <th className="num">BMI</th>
                          <th className="num">Body fat</th>
                          <th className="num">Chest</th>
                          <th className="num">Waist</th>
                          <th className="num">Arms</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {[...measurements].reverse().map((x) => {
                          const bmi = x.weight_kg && x.height_cm ? Number(x.weight_kg) / (Number(x.height_cm) / 100) ** 2 : null;
                          return (
                            <tr key={x.id}>
                              <td>
                                {fmtDate(x.measured_on)}
                                {x.notes && <p className="text-xs text-muted">{x.notes}</p>}
                              </td>
                              <td className="num">{x.weight_kg ? `${x.weight_kg} kg` : "-"}</td>
                              <td className="num">{bmi ? bmi.toFixed(1) : "-"}</td>
                              <td className="num">{x.body_fat_pct ? `${x.body_fat_pct}%` : "-"}</td>
                              <td className="num">{x.chest_cm ?? "-"}</td>
                              <td className="num">{x.waist_cm ?? "-"}</td>
                              <td className="num">{x.arms_cm ?? "-"}</td>
                              <td>
                                <ActionButton
                                  action={deleteRecord.bind(null, "measurements", x.id)}
                                  confirmLabel="Delete measurement"
                                  confirmText={`Delete the measurement from ${fmtDate(x.measured_on)}?`}
                                  successMessage="Deleted"
                                >
                                  <Trash2 size={14} />
                                </ActionButton>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
