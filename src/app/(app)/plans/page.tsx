import { Dumbbell, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { money, todayISO } from "@/lib/format";
import type { Plan, PlanKind } from "@/lib/types";
import { Badge, Card, Empty, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Checkbox, Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { deleteRecord } from "@/app/actions";
import { savePlan } from "./actions";

export const metadata = { title: "Plans · SetFit Fitness" };

function PlanFields({ plan, kind }: { plan?: Plan; kind: PlanKind }) {
  const isPT = kind === "personal_training";
  return (
    <>
      <Hidden name="id" value={plan?.id} />
      <SelectField
        label="Type"
        name="kind"
        defaultValue={plan?.kind ?? kind}
        options={[
          { value: "membership", label: "Gym membership" },
          { value: "personal_training", label: "Personal training package" },
          { value: "pass", label: "Day pass / trial" },
        ]}
      />
      <Field
        label="Plan name"
        name="name"
        defaultValue={plan?.name}
        placeholder={isPT ? "e.g. PT 12 sessions / month" : kind === "pass" ? "e.g. Day pass, 3-day trial" : "e.g. Monthly"}
        required
      />
      <Grid cols={3}>
        <Field label="Duration (days)" name="duration_days" type="number" min={1} defaultValue={plan?.duration_days ?? (kind === "pass" ? 1 : 30)} required />
        <Field label="Price" name="price" type="number" step="0.01" min={0} defaultValue={plan?.price} required />
        <Field label="Admission fee" name="admission_fee" type="number" step="0.01" min={0} defaultValue={plan?.admission_fee ?? 0} />
      </Grid>
      <Field
        label="Sessions included (PT only)"
        name="sessions"
        type="number"
        min={1}
        defaultValue={plan?.sessions ?? (isPT ? 12 : "")}
        hint="Leave empty for unlimited. Ignored for gym memberships."
      />
      <TextArea label="Description / inclusions" name="description" defaultValue={plan?.description} />
      <Checkbox label="Available for new sign-ups" name="is_active" defaultChecked={plan?.is_active ?? true} />
    </>
  );
}

export default async function PlansPage() {
  const settings = await getSettings();
  const sb = await createClient();
  const today = todayISO(settings.timezone);

  const [{ data: plans }, { data: active }] = await Promise.all([
    sb.from("plans").select("*").order("price"),
    sb.from("memberships").select("plan_id").eq("status", "active").gte("end_date", today),
  ]);

  const counts = new Map<string, number>();
  for (const m of active ?? []) if (m.plan_id) counts.set(m.plan_id, (counts.get(m.plan_id) ?? 0) + 1);
  const all = (plans ?? []) as Plan[];

  const section = (kind: PlanKind) => {
    const list = all.filter((p) => (p.kind ?? "membership") === kind);
    const isPT = kind === "personal_training";
    const isPass = kind === "pass";
    return (
      <Card
        title={isPT ? "Personal training packages" : isPass ? "Day passes & trials" : "Gym memberships"}
        bodyClass=""
        className="mb-6"
        action={
          <FormDialog
            title={isPT ? "New PT package" : isPass ? "New day pass / trial" : "New membership plan"}
            trigger={<><Plus size={14} /> {isPT ? "PT package" : isPass ? "Pass" : "Plan"}</>}
            triggerClass="btn-secondary btn-sm"
            action={savePlan}
          >
            <PlanFields kind={kind} />
          </FormDialog>
        }
      >
        {!list.length ? (
          <Empty>
            {isPass
              ? "No passes yet. Add one (e.g. Day pass, 1 day, ₹200) to sell walk-in visits from the Attendance page."
              : isPT
              ? "No PT packages yet. Add one (e.g. 12 sessions in 30 days) to sell personal training."
              : "No plans yet. Create your first membership plan to start enrolling members."}
          </Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{isPT ? "Package" : "Plan"}</th>
                  <th>Duration</th>
                  {isPT && <th className="num">Sessions</th>}
                  <th className="num">Price</th>
                  {!isPT && !isPass && <th className="num">Admission</th>}
                  <th className="num">{isPT ? "Active clients" : isPass ? "Active now" : "Active members"}</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <p className="font-medium text-ink">{p.name}</p>
                      {p.description && <p className="text-xs text-muted line-clamp-1">{p.description}</p>}
                    </td>
                    <td>{p.duration_days} days</td>
                    {isPT && <td className="num">{p.sessions ?? "Unlimited"}</td>}
                    <td className="num">{money(p.price, settings.currency)}</td>
                    {!isPT && !isPass && <td className="num">{money(p.admission_fee, settings.currency)}</td>}
                    <td className="num">{counts.get(p.id) ?? 0}</td>
                    <td>{p.is_active ? <Badge tone="good">Active</Badge> : <Badge>Archived</Badge>}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <FormDialog title="Edit plan" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={savePlan}>
                          <PlanFields plan={p} kind={kind} />
                        </FormDialog>
                        <ActionButton
                          action={deleteRecord.bind(null, "plans", p.id)}
                          confirmLabel="Delete plan"
                          confirmText={`Delete "${p.name}"? Existing memberships keep their details. To stop selling it but keep it on record, edit it and untick "Available for new sign-ups".`}
                          successMessage="Plan deleted"
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
    );
  };

  return (
    <>
      <PageHeader
        title="Plans & packages"
        description={
          <span className="inline-flex items-center gap-1">
            Gym memberships and <Dumbbell size={14} /> personal training packages. Prices are copied onto each sale, so editing a plan never changes past bills.
          </span>
        }
      />
      {section("membership")}
      {section("personal_training")}
      {section("pass")}
    </>
  );
}
