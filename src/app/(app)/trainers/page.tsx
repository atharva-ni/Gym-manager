import { Banknote, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { fmtDate, money, monthLabel, monthStart, todayISO } from "@/lib/format";
import { options, PAYMENT_METHODS } from "@/lib/constants";
import type { Trainer } from "@/lib/types";
import { Avatar, Card, Empty, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { deleteRecord } from "@/app/actions";
import { paySalary, saveTrainer } from "./actions";

export const metadata = { title: "Staff · SetFit Fitness" };

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
    </>
  );
}

export default async function TrainersPage() {
  const settings = await getSettings();
  const today = todayISO(settings.timezone);
  const sb = await createClient();
  const [{ data }, { data: assigned }, { data: classes }, { data: ptRows }] = await Promise.all([
    sb.from("trainers").select("*").order("status").order("full_name"),
    sb.from("members").select("trainer_id").eq("status", "active").not("trainer_id", "is", null),
    sb.from("classes").select("trainer_id").eq("is_active", true).not("trainer_id", "is", null),
    sb.rpc("trainer_pt_stats", { p_from: monthStart(today), p_to: today, p_today: today }),
  ]);
  const pt = new Map(
    ((ptRows ?? []) as { trainer_id: string; clients: number; revenue: number }[]).map((r) => [
      r.trainer_id,
      { clients: Number(r.clients), revenue: Number(r.revenue) },
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

  return (
    <>
      <PageHeader
        title="Staff"
        description="Trainers and employees, their assignments and payroll."
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
      <Card bodyClass="">
        {!trainers.length ? (
          <Empty>No staff yet.</Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Contact</th>
                  <th className="num">Members</th>
                  <th className="num">PT clients</th>
                  <th className="num">PT fees (month)</th>
                  <th className="num">Salary + commission</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trainers.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={t.full_name} />
                        <div>
                          <p className="font-medium text-ink">{t.full_name}</p>
                          <p className="text-xs text-muted">Since {fmtDate(t.joined_on)}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      {t.role}
                      {t.specialization && <p className="text-xs text-muted">{t.specialization}</p>}
                    </td>
                    <td className="text-xs">
                      {t.phone ?? "-"}
                      {t.email && <p className="text-muted">{t.email}</p>}
                    </td>
                    <td className="num">
                      {memberCount.get(t.id) ?? 0}
                      {classCount.get(t.id) ? <span className="block text-xs text-muted">{classCount.get(t.id)} classes</span> : null}
                    </td>
                    <td className="num">{pt.get(t.id)?.clients ?? 0}</td>
                    <td className="num">{money(pt.get(t.id)?.revenue ?? 0, settings.currency)}</td>
                    <td className="num">
                      {money(t.salary, settings.currency)}
                      {commissionOf(t) > 0 && (
                        <span className="block text-xs text-muted">
                          + {money(commissionOf(t), settings.currency)} ({Number(t.pt_commission_pct)}%)
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <FormDialog
                          title={`Pay salary: ${t.full_name}`}
                          trigger={<Banknote size={14} />}
                          triggerClass="btn-ghost btn-sm"
                          action={paySalary}
                          submitLabel="Record payout"
                        >
                          <Hidden name="vendor" value={t.full_name} />
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
                        <FormDialog title="Edit staff member" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={saveTrainer} wide>
                          <TrainerFields t={t} today={today} />
                        </FormDialog>
                        <ActionButton
                          action={deleteRecord.bind(null, "trainers", t.id)}
                          confirmLabel="Delete staff member"
                          confirmText={`Delete ${t.full_name}? Their members, PT clients and classes will be unassigned. To keep their history, edit them and set Status to Inactive instead.`}
                          successMessage="Staff member deleted"
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
