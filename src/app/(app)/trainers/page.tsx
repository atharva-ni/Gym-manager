import { Banknote, History, KeyRound, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings, requireOwner } from "@/lib/auth";
import { fmtDate, money, monthLabel, monthStart, plural, todayISO } from "@/lib/format";
import { options, PAYMENT_METHODS, STAFF_CAN, STAFF_CANNOT } from "@/lib/constants";
import type { Trainer } from "@/lib/types";
import { Avatar, Badge, Card, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { ActionButton, FormDialog, ViewDialog } from "@/components/forms";
import { Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { PasswordField } from "@/components/password-field";
import { deleteRecord } from "@/app/actions";
import { addStaff, paySalary, saveStaffLimit, saveTrainer, setStaffActive } from "./actions";

export const metadata = { title: "Staff · SetFit Fitness" };

type Login = { id: string; full_name: string; email: string; active: boolean; user_id: string | null; trainer_id: string | null };


function TrainerFields({ t, today }: { t?: Trainer; today: string }) {
  return (
    <>
      <Hidden name="id" value={t?.id} />
      <Grid>
        <Field label="Full name" name="full_name" defaultValue={t?.full_name} required />
        <Field label="Role" name="role" defaultValue={t?.role ?? "Trainer"} list="staff-roles" required />
        <Field label="Phone" name="phone" type="tel" defaultValue={t?.phone ?? ""} />
        <Field label="Email" name="email" type="email" defaultValue={t?.email ?? ""} />
        <Field label="Specialization" name="specialization" defaultValue={t?.specialization ?? ""} placeholder="Strength, Yoga, CrossFit…" />
        <Field label="Monthly salary" name="salary" type="number" step="0.01" min={0} defaultValue={t?.salary ?? 0} />
        <Field
          label="PT commission %"
          name="pt_commission_pct"
          type="number"
          step="0.01"
          min={0}
          max={100}
          defaultValue={t?.pt_commission_pct ?? 50}
          hint="Trainer's share of personal training fees collected."
        />
        <Field label="Joined on" name="joined_on" type="date" defaultValue={t?.joined_on ?? today} required />
        <SelectField label="Status" name="status" defaultValue={t?.status ?? "active"} options={options(["active", "inactive"])} />
      </Grid>
      <datalist id="staff-roles">
        {["Trainer", "Head Coach", "Receptionist", "Manager", "Cleaner", "Nutritionist"].map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <TextArea label="Notes" name="notes" rows={2} defaultValue={t?.notes} />
      {!t && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <p className="text-sm font-medium text-ink">App login</p>
          <Grid>
            <Field label="Login email" name="login_email" type="email" autoComplete="off" hint="Can be the same as their email above." required />
            <PasswordField label="Temporary password" name="login_password" autoComplete="new-password" minLength={8} />
          </Grid>
          <p className="text-xs text-muted">
            Give them this email and password; they can change the password under My account. {STAFF_CAN} {STAFF_CANNOT}
          </p>
        </div>
      )}
    </>
  );
}

export default async function TrainersPage() {
  await requireOwner(); // staff are sent to check-in
  const settings = await getSettings();
  const today = todayISO(settings.timezone);
  const sb = await createClient();
  const [{ data }, { data: assigned }, { data: classes }, { data: ptRows }, { data: payoutRows }, { data: loginRows }] = await Promise.all([
    sb.from("trainers").select("*").order("status").order("full_name"),
    sb.from("members").select("trainer_id").eq("status", "active").not("trainer_id", "is", null),
    sb.from("classes").select("trainer_id").eq("is_active", true).not("trainer_id", "is", null),
    sb.rpc("trainer_pt_stats", { p_from: monthStart(today), p_to: today, p_today: today }),
    sb
      .from("expenses")
      .select("id, trainer_id, amount, spent_on, description, method")
      .eq("category", "salary")
      .not("trainer_id", "is", null)
      .order("spent_on", { ascending: false })
      .limit(1000),
    sb.from("staff_accounts").select("id, full_name, email, active, user_id, trainer_id").order("created_at"),
  ]);
  const logins = (loginRows ?? []) as Login[];
  const loginOf = (id: string) => logins.find((l) => l.trainer_id === id);
  const otherLogins = logins.filter((l) => !l.trainer_id);
  type Payout = { id: string; trainer_id: string; amount: number; spent_on: string; description: string | null; method: string };
  const payouts = (payoutRows ?? []) as Payout[];
  const payoutsOf = (id: string) => payouts.filter((p) => p.trainer_id === id);
  const paidThisMonth = (id: string) =>
    payoutsOf(id).filter((p) => p.spent_on >= monthStart(today)).reduce((sum, p) => sum + Number(p.amount), 0);
  const pt = new Map(
    ((ptRows ?? []) as { trainer_id: string; clients: number; revenue: number; sessions: number }[]).map((r) => [
      r.trainer_id,
      { clients: Number(r.clients), revenue: Number(r.revenue), sessions: Number(r.sessions ?? 0) },
    ]),
  );
  const commissionOf = (t: Trainer) => Math.round(((pt.get(t.id)?.revenue ?? 0) * Number(t.pt_commission_pct ?? 0)) / 100);
  const trainers = (data ?? []) as Trainer[];
  const tally = (rows: { trainer_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.trainer_id, (m.get(r.trainer_id) ?? 0) + 1);
    return m;
  };
  const memberCount = tally(assigned);
  const classCount = tally(classes);
  const active = trainers.filter((t) => t.status === "active");
  const payroll = active.reduce((s, t) => s + Number(t.salary), 0);
  const ptRevenue = [...pt.values()].reduce((s, r) => s + r.revenue, 0);
  const commissions = active.reduce((s, t) => s + commissionOf(t), 0);

  const loginBadge = (l: Login) =>
    !l.active ? <Badge>Switched off</Badge> : l.user_id ? <Badge tone="good">Can sign in</Badge> : <Badge tone="warn">Not signed in yet</Badge>;
  const switchLogin = (l: Login) => (
    <ActionButton
      action={setStaffActive.bind(null, l.id, !l.active)}
      className="btn-secondary btn-sm"
      confirmText={l.active ? `Switch off ${l.full_name}'s login? They lose access straight away.` : undefined}
      confirmLabel="Switch off"
      successMessage={l.active ? "Login switched off" : "Login switched on"}
    >
      {l.active ? "Switch off" : "Switch on"}
    </ActionButton>
  );

  return (
    <>
      <PageHeader
        title="Staff"
        description="Trainers and employees: their members, PT, salary and app login. Adding a staff member creates their login."
        actions={
          <FormDialog title="Add staff member" trigger={<><Plus size={16} /> Add staff</>} action={saveTrainer} wide>
            <TrainerFields today={today} />
          </FormDialog>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active staff" value={active.length} hint={`Payroll ${money(payroll, settings.currency)} / month`} />
        <Stat label="PT clients" value={[...pt.values()].reduce((s, r) => s + r.clients, 0)} hint="Active PT packages" />
        <Stat label="PT fees this month" value={money(ptRevenue, settings.currency)} tone="brand" />
        <Stat label="PT commission due" value={money(commissions, settings.currency)} hint="Added to salary payouts" tone="warn" />
      </div>

      <Card
        title="App logins"
        className="mb-6"
        action={
          <FormDialog
            title="Staff discount limit"
            trigger={
              <>
                <Pencil size={14} /> Discount limit
              </>
            }
            triggerClass="btn-secondary btn-sm"
            action={saveStaffLimit}
            successMessage="Discount limit saved"
          >
            <Field
              label="Most a staff login can discount (%)"
              name="staff_max_discount_pct"
              type="number"
              step="0.01"
              min={0}
              max={100}
              defaultValue={settings.staff_max_discount_pct ?? ""}
              placeholder="No limit"
              hint="Of the fee, on each bill. Leave empty for no limit. You (the owner) have no limit."
            />
          </FormDialog>
        }
      >
        <p className="text-sm text-ink-2">Every staff member gets their own login, so the activity log shows who did what.</p>
        <ul className="mt-2 space-y-1 text-sm text-ink-2">
          <li>
            <span className="font-medium text-good">Can:</span> {STAFF_CAN.replace(/^Staff can /, "")}
          </li>
          <li>
            <span className="font-medium text-bad">Can&apos;t:</span> {STAFF_CANNOT.replace(/^They can't /, "")}
          </li>
        </ul>
        <p className="mt-2 text-sm text-ink-2">
          Discount limit:{" "}
          <span className="font-medium text-ink">
            {settings.staff_max_discount_pct === null || settings.staff_max_discount_pct === undefined ? "no limit" : `${Number(settings.staff_max_discount_pct)}%`}
          </span>
        </p>
        {otherLogins.length > 0 && (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {otherLogins.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{l.full_name}</p>
                  <p className="break-all text-xs text-muted">{l.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {loginBadge(l)}
                  {switchLogin(l)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!trainers.length ? (
        <Card>
          <Empty>No staff yet. Use Add staff above for each trainer and front-desk person; each gets their own login.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {trainers.map((t) => {
            const p = pt.get(t.id);
            const login = loginOf(t.id);
            const paid = paidThisMonth(t.id);
            const coaches = /trainer|coach|instructor/i.test(t.role) || (p?.clients ?? 0) > 0 || (memberCount.get(t.id) ?? 0) > 0;
            return (
              <section key={t.id} className={`card flex flex-col ${t.status === "inactive" ? "opacity-70" : ""}`}>
                <div className="flex items-start gap-3 p-4">
                  <Avatar name={t.full_name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {t.full_name}
                      {t.status === "inactive" && <StatusBadge status={t.status} />}
                    </p>
                    <p className="text-sm text-ink-2">
                      {t.role}
                      {t.specialization && <span className="text-muted"> · {t.specialization}</span>}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      {t.phone && (
                        <a href={`tel:${t.phone}`} className="inline-flex items-center gap-1 hover:text-brand">
                          <Phone size={12} /> {t.phone}
                        </a>
                      )}
                      {t.email && (
                        <span className="inline-flex min-w-0 items-center gap-1 break-all">
                          <Mail size={12} /> {t.email}
                        </span>
                      )}
                      <span>Since {fmtDate(t.joined_on)}</span>
                    </p>
                  </div>
                </div>

                {coaches && (
                  <dl className="grid grid-cols-3 gap-2 border-t border-line px-4 py-3 text-center">
                    <div>
                      <dt className="text-xs text-muted">Members</dt>
                      <dd className="font-semibold tabular-nums text-ink">{memberCount.get(t.id) ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">PT clients</dt>
                      <dd className="font-semibold tabular-nums text-ink">{p?.clients ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Sessions</dt>
                      <dd className="font-semibold tabular-nums text-ink">{p?.sessions ?? 0}</dd>
                    </div>
                    {(classCount.get(t.id) || p?.revenue) ? (
                      <dd className="col-span-3 text-xs text-muted">
                        {classCount.get(t.id) ? `${plural(classCount.get(t.id)!, "class", "classes")} · ` : ""}PT fees this month {money(p?.revenue ?? 0, settings.currency)}
                      </dd>
                    ) : null}
                  </dl>
                )}

                <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
                  <div>
                    <p className="text-ink">
                      {money(t.salary, settings.currency)}
                      <span className="text-muted"> / month</span>
                    </p>
                    {commissionOf(t) > 0 && (
                      <p className="text-xs text-muted">
                        + {money(commissionOf(t), settings.currency)} PT commission ({Number(t.pt_commission_pct)}%)
                      </p>
                    )}
                  </div>
                  {t.status === "active" &&
                    (paid > 0 ? <Badge tone="good">Paid {money(paid, settings.currency)}</Badge> : <Badge tone="warn">Not paid this month</Badge>)}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
                  {login ? (
                    <>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs text-muted">
                          <KeyRound size={12} /> App login
                        </p>
                        <p className="break-all text-ink">{login.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {loginBadge(login)}
                        {switchLogin(login)}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="flex items-center gap-1.5 text-muted">
                        <KeyRound size={14} /> No app login
                      </p>
                      {t.status === "active" && (
                        <FormDialog
                          title={`App login for ${t.full_name}`}
                          trigger="Give app login"
                          triggerClass="btn-secondary btn-sm"
                          action={addStaff}
                          submitLabel="Create login"
                          successMessage="Login created"
                        >
                          <Hidden name="trainer_id" value={t.id} />
                          <Hidden name="full_name" value={t.full_name} />
                          <Field label="Login email" name="email" type="email" autoComplete="off" defaultValue={t.email ?? ""} required />
                          <PasswordField label="Temporary password" name="password" autoComplete="new-password" minLength={8} />
                          <p className="text-xs text-muted">
                            Give them the email and temporary password; they can change it under My account. {STAFF_CAN} {STAFF_CANNOT}
                          </p>
                        </FormDialog>
                      )}
                    </>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap gap-1 border-t border-line p-2">
                  <FormDialog
                    title={`Pay salary: ${t.full_name}`}
                    trigger={
                      <>
                        <Banknote size={14} /> Pay salary
                      </>
                    }
                    triggerClass="btn-ghost btn-sm"
                    action={paySalary}
                    submitLabel="Record payout"
                  >
                    <Hidden name="vendor" value={t.full_name} />
                    <Hidden name="trainer_id" value={t.id} />
                    {paid > 0 && (
                      <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                        Already paid {money(paid, settings.currency)} to {t.full_name} this month.
                      </p>
                    )}
                    <p className="text-sm text-muted">
                      Recorded as a salary expense.
                      {commissionOf(t) > 0 && ` Includes ${money(commissionOf(t), settings.currency)} PT commission for this month.`}
                    </p>
                    <Grid>
                      <Field label="Amount" name="amount" type="number" step="0.01" min={0.01} defaultValue={Number(t.salary) + commissionOf(t) || undefined} required />
                      <Field label="Date" name="spent_on" type="date" defaultValue={today} required />
                      <SelectField label="Method" name="method" defaultValue="bank" options={options(PAYMENT_METHODS)} />
                      <Field
                        label="Description"
                        name="description"
                        defaultValue={`Salary ${monthLabel(today)}${commissionOf(t) > 0 ? " + PT commission" : ""}`}
                      />
                    </Grid>
                  </FormDialog>
                  {payoutsOf(t.id).length > 0 && (
                    <ViewDialog
                      title={`Salary history: ${t.full_name}`}
                      trigger={
                        <>
                          <History size={14} /> History
                        </>
                      }
                    >
                      <ul className="divide-y divide-line text-sm">
                        {payoutsOf(t.id).map((po) => (
                          <li key={po.id} className="flex items-center justify-between gap-3 py-2">
                            <span>
                              {fmtDate(po.spent_on)}
                              {po.description && <span className="block text-xs text-muted">{po.description}</span>}
                            </span>
                            <span className="tabular-nums font-medium text-ink">{money(po.amount, settings.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </ViewDialog>
                  )}
                  <FormDialog
                    title="Edit staff member"
                    trigger={
                      <>
                        <Pencil size={14} /> Edit
                      </>
                    }
                    triggerClass="btn-ghost btn-sm"
                    action={saveTrainer}
                    wide
                  >
                    <TrainerFields t={t} today={today} />
                  </FormDialog>
                  <span className="ml-auto">
                    <ActionButton
                      action={deleteRecord.bind(null, "trainers", t.id)}
                      confirmLabel="Delete staff member"
                      confirmText={`Delete ${t.full_name}? Their members, PT clients and classes will be unassigned, and their app login is switched off. To keep their history, edit them and set Status to Inactive instead.`}
                      successMessage="Staff member deleted"
                      title="Delete staff member"
                    >
                      <Trash2 size={14} />
                    </ActionButton>
                  </span>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
