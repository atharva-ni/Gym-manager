import { Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings, requireOwner } from "@/lib/auth";
import { money, priceTag, todayISO } from "@/lib/format";
import { durationLabel, groupPlans, perMonth, savingPct, type PlanGroup } from "@/lib/plans";
import type { Plan, PlanKind } from "@/lib/types";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Field } from "@/components/fields";
import { deletePlanGroup, saveAdmissionFee, savePlanGroup } from "./actions";
import { PlanGroupFields } from "./plan-group-fields";

export const metadata = { title: "Plans · SetFit Fitness" };

const SECTIONS: { kind: PlanKind; title: string; noun: string; empty: string }[] = [
  {
    kind: "membership",
    title: "Gym memberships",
    noun: "plan",
    empty: "No plans yet. Create one (e.g. Silver: 1, 3, 6 and 12 months) to start taking admissions.",
  },
  {
    kind: "personal_training",
    title: "Personal training packages",
    noun: "PT package",
    empty: "No PT packages yet. Add one (e.g. 12 sessions a month, for 1 or 3 months) to sell personal training.",
  },
  {
    kind: "pass",
    title: "Day passes & trials",
    noun: "pass",
    empty: "No passes yet. Add one (e.g. Day pass, 1 day, ₹200) to sell walk-in visits from the Attendance page.",
  },
];

export default async function PlansPage() {
  await requireOwner(); // staff are sent to check-in
  const settings = await getSettings();
  const { currency } = settings;
  const sb = await createClient();
  const today = todayISO(settings.timezone);

  const [{ data: plans }, { data: active }] = await Promise.all([
    sb.from("plans").select("*").order("price"),
    sb.from("memberships").select("plan_id").eq("status", "active").gte("end_date", today),
  ]);
  const counts: Record<string, number> = {};
  for (const m of active ?? []) if (m.plan_id) counts[m.plan_id] = (counts[m.plan_id] ?? 0) + 1;
  const groups = groupPlans((plans ?? []) as Plan[]);

  const groupCard = (g: PlanGroup<Plan>, noun: string) => {
    const members = g.options.reduce((s, o) => s + (counts[o.id] ?? 0), 0);
    const isPT = g.kind === "personal_training";
    return (
      <li key={g.name} className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
              {g.name}
              {!g.active && <Badge>Not on sale</Badge>}
            </p>
            {g.description && <p className="text-sm text-muted">{g.description}</p>}
            <p className="mt-0.5 text-xs text-muted">
              {members} active {isPT ? "client" : "member"}
              {members === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex gap-1">
            <FormDialog
              title={`Edit ${g.name}`}
              trigger={
                <>
                  <Pencil size={14} /> Edit
                </>
              }
              triggerClass="btn-secondary btn-sm"
              action={savePlanGroup}
              successMessage="Plan saved"
            >
              <PlanGroupFields kind={g.kind} group={g} activeCounts={counts} />
            </FormDialog>
            <ActionButton
              action={deletePlanGroup.bind(null, g.kind, g.name)}
              confirmLabel={`Delete ${noun}`}
              confirmText={`Delete "${g.name}"? Durations already sold are kept on record (and switched off); members keep their plan details.`}
              successMessage="Removed"
            >
              <Trash2 size={14} />
              <span className="sm:sr-only">Delete</span>
            </ActionButton>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {g.options.map((o) => {
            const pm = perMonth(o);
            const save = savingPct(o, g.options);
            return (
              <li
                key={o.id}
                className={`rounded-lg border p-3 ${o.is_active ? "border-line bg-surface" : "border-dashed border-line bg-surface-2 text-muted"}`}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{durationLabel(o)}</p>
                <p className={`text-lg font-semibold tabular-nums ${o.is_active ? "text-ink" : ""}`}>{priceTag(o.price, currency)}</p>
                <p className="text-xs text-muted">
                  {isPT && <>{o.sessions ? `${o.sessions} sessions` : "Unlimited sessions"} · </>}
                  {pm && o.duration_months !== 1 ? `${priceTag(pm, currency)}/mo` : null}
                  {save ? <span className="text-good"> · save {save}%</span> : null}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {o.is_active ? `${counts[o.id] ?? 0} active` : "Not on sale"}
                </p>
              </li>
            );
          })}
        </ul>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Plans & packages"
        description="Each plan has its durations and prices. Gym and PT plans run in calendar months; editing a price never changes past bills."
      />
      <Card className="mb-6" bodyClass="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <p className="font-semibold text-ink">Admission fee</p>
          <p className="text-sm text-muted">
            {Number(settings.admission_fee) > 0 ? (
              <>
                <span className="font-medium text-ink">{money(settings.admission_fee, currency)}</span>, charged once on a new admission, whatever the plan.
                Shown as its own line on the bill and never refunded.
              </>
            ) : (
              "No admission fee. Set one to charge it once on every new admission."
            )}
          </p>
        </div>
        <FormDialog
          title="Admission fee"
          trigger={
            <>
              <Pencil size={14} /> Edit
            </>
          }
          triggerClass="btn-secondary btn-sm"
          action={saveAdmissionFee}
          successMessage="Admission fee saved"
        >
          <Field
            label="Admission fee"
            name="admission_fee"
            type="number"
            step="0.01"
            min={0}
            defaultValue={Number(settings.admission_fee ?? 0)}
            hint="One-time fee on a new admission. 0 = none. You can still untick it on any bill."
            required
          />
        </FormDialog>
      </Card>
      {SECTIONS.map((s) => {
        const list = groups.filter((g) => g.kind === s.kind);
        return (
          <Card
            key={s.kind}
            title={s.title}
            bodyClass=""
            className="mb-6"
            action={
              <FormDialog
                title={`New ${s.noun}`}
                trigger={
                  <>
                    <Plus size={14} /> {s.noun[0].toUpperCase() + s.noun.slice(1)}
                  </>
                }
                triggerClass="btn-secondary btn-sm"
                action={savePlanGroup}
                successMessage="Plan saved"
              >
                <PlanGroupFields kind={s.kind} />
              </FormDialog>
            }
          >
            {list.length ? <ul className="divide-y divide-line">{list.map((g) => groupCard(g, s.noun))}</ul> : <Empty>{s.empty}</Empty>}
          </Card>
        );
      })}
    </>
  );
}
