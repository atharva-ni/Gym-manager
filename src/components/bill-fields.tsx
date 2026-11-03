"use client";

import { useMemo, useState } from "react";
import { addDays, fmtDate, money } from "@/lib/format";
import { groupPlans, planEnd, planLabel, type PlanOption } from "@/lib/plans";
import { PaymentModeFields } from "@/components/payment-mode-fields";
import { PlanPicker } from "@/components/plan-picker";
import { SubmitButton } from "@/components/forms";
import { planChangeCredit } from "@/lib/billing";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One bill: an optional gym membership plus an optional PT package, the
 * admission fee (its own line), a discount (₹ or %), and what is paid now
 * and on which date. Shows a live summary and leaves any unpaid amount as a
 * balance with a due date. With `changeFrom` it becomes a plan change:
 * unused days on the old plan are credited. Mirrors the server-side maths in
 * members/actions.ts (readBillForm / saveBill / changePlan).
 */
export function BillFields({
  plans,
  ptPlans,
  trainers,
  currency,
  today,
  startDate,
  ptStartDate,
  defaultTrainerId,
  ptOnly,
  chargeAdmission = true,
  admissionFee = 0,
  maxDiscountPct = null,
  changeFrom,
  layout = "stack",
  submitLabel,
}: {
  plans: PlanOption[];
  ptPlans: PlanOption[];
  trainers: { id: string; full_name: string }[];
  currency: string;
  today: string;
  startDate: string;
  ptStartDate: string;
  defaultTrainerId?: string | null;
  /** Bill only a PT package (existing member adding personal training). */
  ptOnly?: boolean;
  /** Tick "charge admission fee" by default (new admissions yes, renewals no). */
  chargeAdmission?: boolean;
  /** One-time admission fee from Settings (0 = none). */
  admissionFee?: number;
  /** Staff logins: the most they may discount, in % (null = no limit). */
  maxDiscountPct?: number | null;
  /** Plan change: the current plan whose unused, paid days become credit. */
  changeFrom?: {
    plan_name: string;
    price: number;
    discount: number;
    paid: number;
    start_date: string;
    end_date: string;
    /** Freezes on the current plan; frozen days are neither used nor credited. */
    freezes?: { start_date: string; end_date: string }[];
  };
  /** "split": form and a sticky summary side by side on wide screens (admission page). */
  layout?: "stack" | "split";
  /** Adds a sticky total bar with this submit button on phones. */
  submitLabel?: string;
}) {
  const gymGroups = useMemo(() => groupPlans(plans), [plans]);
  const ptGroups = useMemo(() => groupPlans(ptPlans), [ptPlans]);
  const [planId, setPlanId] = useState(ptOnly ? "" : (gymGroups[0]?.options[0]?.id ?? ""));
  const [admission, setAdmission] = useState(chargeAdmission);
  const [ptOn, setPtOn] = useState(!!ptOnly);
  const [ptPlanId, setPtPlanId] = useState(ptGroups[0]?.options[0]?.id ?? "");
  const [discType, setDiscType] = useState<"amount" | "percent">("amount");
  const [discValue, setDiscValue] = useState("");
  const [paid, setPaid] = useState<string | null>(null); // null = follow the total
  const [start, setStart] = useState(startDate);
  const [ptStart, setPtStart] = useState(ptStartDate);

  const plan = plans.find((p) => p.id === planId);
  const pt = ptOn ? ptPlans.find((p) => p.id === ptPlanId) : undefined;
  const planEnds = plan && start ? planEnd(start, plan) : null;
  const ptEnds = pt && ptStart ? planEnd(ptStart, pt) : null;
  const showAdmission = !changeFrom && !ptOnly && admissionFee > 0;
  const lines = [
    plan && { label: planLabel(plan), sub: planEnds ? `${fmtDate(start)} to ${fmtDate(planEnds)}` : null, amount: Number(plan.price) },
    pt && {
      label: `PT: ${planLabel(pt)}`,
      sub: [pt.sessions ? `${pt.sessions} sessions` : null, ptEnds ? `${fmtDate(ptStart)} to ${fmtDate(ptEnds)}` : null].filter(Boolean).join(" · "),
      amount: Number(pt.price),
    },
    showAdmission && admission && (plan || pt) && { label: "Admission fee", sub: "One time", amount: admissionFee },
  ].filter(Boolean) as { label: string; sub: string | null; amount: number }[];

  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const dv = Number(discValue) || 0;
  const userDiscount = Math.max(0, r2(discType === "percent" ? (subtotal * dv) / 100 : dv));
  const change =
    changeFrom && (plan || pt) ? planChangeCredit(changeFrom, (plan ? start : ptStart) || startDate, changeFrom.freezes ?? []) : null;
  const credit = change?.credit ?? 0;
  const discount = Math.min(subtotal, r2(userDiscount + credit));
  const total = r2(subtotal - discount);
  const paidNow = paid === null ? total : Math.min(total, Math.max(0, Number(paid) || 0));
  const balance = r2(total - paidNow);
  const overCap = maxDiscountPct !== null && subtotal > 0 && userDiscount > r2((subtotal * maxDiscountPct) / 100) + 0.01;
  const reset = () => setPaid(null);

  const changeNote = change && changeFrom && (
    <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">
      {changeFrom.plan_name}: {change.usedDays} of {change.totalDays} days used ({money(change.usedValue, currency)}).
      {credit > 0 ? ` ${money(credit, currency)} paid for unused days is credited to the new plan.` : " Nothing extra was paid, so there is no credit."}
    </p>
  );

  const form = (
    <div className="space-y-5">
      {/* Gym membership */}
      {!ptOnly && (
        <section className="space-y-3">
          <p className="text-sm font-medium text-ink">{changeFrom ? "Change to" : "Gym membership"}</p>
          {gymGroups.length ? (
            <PlanPicker
              name="plan_id"
              groups={gymGroups}
              value={planId}
              onChange={(id) => {
                setPlanId(id);
                reset();
              }}
              currency={currency}
              noneLabel={changeFrom ? undefined : "No gym plan"}
            />
          ) : (
            <p className="text-sm text-muted">No gym plans on sale.</p>
          )}
          {plan && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">{changeFrom ? "New plan starts" : "Starts"}</span>
                <input
                  type="date"
                  name="start_date"
                  className="input"
                  value={start}
                  min={changeFrom ? today : undefined}
                  max={changeFrom?.end_date}
                  required
                  onChange={(e) => {
                    setStart(e.target.value);
                    reset();
                  }}
                />
              </label>
              <div className="flex items-end pb-2 text-sm text-ink-2">
                {planEnds && (
                  <span>
                    Valid till <span className="font-medium text-ink">{fmtDate(planEnds)}</span>
                  </span>
                )}
              </div>
            </div>
          )}
          {!ptOnly && changeNote}
        </section>
      )}

      {/* Personal training */}
      {ptGroups.length > 0 && (
        <section className={ptOnly ? "space-y-3" : "space-y-3 rounded-lg border border-line p-3"}>
          {!ptOnly ? (
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={ptOn}
                onChange={(e) => {
                  setPtOn(e.target.checked);
                  reset();
                }}
                className="size-4 accent-[var(--brand)]"
              />
              Add personal training
            </label>
          ) : (
            <p className="text-sm font-medium text-ink">{changeFrom ? "Change to" : "PT package"}</p>
          )}
          {ptOn && (
            <>
              <PlanPicker
                name="pt_plan_id"
                groups={ptGroups}
                value={ptPlanId}
                onChange={(id) => {
                  setPtPlanId(id);
                  reset();
                }}
                currency={currency}
                sessions
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">
                    Trainer<span className="text-bad"> *</span>
                  </span>
                  <select name="trainer_id" className="input" defaultValue={defaultTrainerId ?? ""} required>
                    <option value="">Select trainer</option>
                    {trainers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">PT starts</span>
                  <input
                    type="date"
                    name="pt_start_date"
                    className="input"
                    value={ptStart}
                    min={changeFrom ? today : undefined}
                    max={changeFrom?.end_date}
                    onChange={(e) => {
                      setPtStart(e.target.value);
                      reset();
                    }}
                  />
                  {ptEnds && <span className="mt-1 block text-xs text-muted">Valid till {fmtDate(ptEnds)}</span>}
                </label>
              </div>
            </>
          )}
          {ptOnly && changeNote}
        </section>
      )}

      {showAdmission && (plan || pt) && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            name="include_admission"
            checked={admission}
            onChange={(e) => {
              setAdmission(e.target.checked);
              reset();
            }}
            className="size-4 accent-[var(--brand)]"
          />
          Charge admission fee ({money(admissionFee, currency)}, one time)
        </label>
      )}

      {/* Discount */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <label className="block">
          <span className="label">Discount</span>
          <input
            name="discount_value"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            max={discType === "percent" ? 100 : undefined}
            className="input"
            placeholder="0"
            value={discValue}
            onChange={(e) => {
              setDiscValue(e.target.value);
              reset();
            }}
          />
        </label>
        <label className="block">
          <span className="label">Type</span>
          <select
            name="discount_type"
            className="input"
            value={discType}
            onChange={(e) => {
              setDiscType(e.target.value as "amount" | "percent");
              reset();
            }}
          >
            <option value="amount">₹ off</option>
            <option value="percent">% off</option>
          </select>
        </label>
        <label className="col-span-2 block sm:col-span-1">
          <span className="label">Reason</span>
          <input name="discount_reason" className="input" placeholder="e.g. Diwali offer, couple, student" />
        </label>
      </div>
      {maxDiscountPct !== null && (
        <p className={`-mt-3 text-xs ${overCap ? "text-bad" : "text-muted"}`}>
          {overCap ? "More than you can give. " : ""}Staff discount limit: {maxDiscountPct}% ({money(r2((subtotal * maxDiscountPct) / 100), currency)} on this bill).
        </p>
      )}

      {/* Payment */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Paid now</span>
          <input
            name="amount_paid"
            type="number"
            inputMode="decimal"
            min={0}
            max={total}
            step="0.01"
            className="input"
            value={paid === null ? String(total) : paid}
            onChange={(e) => setPaid(e.target.value)}
          />
          <span className="mt-1 flex gap-4 text-xs">
            <button type="button" className="py-1 text-brand" onClick={reset}>
              Full
            </button>
            <button type="button" className="py-1 text-brand" onClick={() => setPaid(String(r2(total / 2)))}>
              Half
            </button>
            <button type="button" className="py-1 text-brand" onClick={() => setPaid("0")}>
              Nothing now
            </button>
          </span>
        </label>
        {paidNow > 0 && (
          <label className="block">
            <span className="label">Payment date</span>
            <input type="date" name="paid_on" className="input" defaultValue={today} max={today} min={addDays(today, -366)} />
            <span className="mt-1 block text-xs text-muted">Change only when entering a payment made earlier.</span>
          </label>
        )}
        {balance > 0 && (
          <label className="block">
            <span className="label">Balance due by</span>
            <input type="date" name="balance_due_on" className="input" min={today} defaultValue={addDays(today, 7)} />
          </label>
        )}
      </div>
      {paidNow > 0 && <PaymentModeFields total={paidNow} currency={currency} />}
    </div>
  );

  const summary = (
    <div className="rounded-lg bg-surface-2 p-4 text-sm">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Bill</p>
      {lines.length === 0 ? (
        <p className="text-muted">Choose a membership and/or personal training to build the bill.</p>
      ) : (
        <dl className="space-y-1.5">
          {lines.map((l) => (
            <div key={l.label} className="flex justify-between gap-4">
              <dt className="text-ink-2">
                {l.label}
                {l.sub && <span className="block text-xs text-muted">{l.sub}</span>}
              </dt>
              <dd className="tabular-nums">{money(l.amount, currency)}</dd>
            </div>
          ))}
          {credit > 0 && (
            <div className="flex justify-between gap-4 text-good">
              <dt>Credit from {changeFrom?.plan_name}</dt>
              <dd className="tabular-nums">- {money(Math.min(credit, subtotal), currency)}</dd>
            </div>
          )}
          {discount - Math.min(credit, subtotal) > 0 && (
            <div className="flex justify-between gap-4 text-good">
              <dt>Discount{discType === "percent" && dv ? ` (${dv}%)` : ""}</dt>
              <dd className="tabular-nums">- {money(r2(discount - Math.min(credit, subtotal)), currency)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-semibold text-ink">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(total, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Paid now</dt>
            <dd className="tabular-nums">{money(paidNow, currency)}</dd>
          </div>
          <div className={`flex justify-between gap-4 font-semibold ${balance > 0 ? "text-bad" : "text-good"}`}>
            <dt>Balance</dt>
            <dd className="tabular-nums">{balance > 0 ? money(balance, currency) : "Fully paid"}</dd>
          </div>
        </dl>
      )}
    </div>
  );

  return (
    <div className={layout === "split" ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start" : "space-y-4"}>
      {form}
      <div className={layout === "split" ? "lg:sticky lg:top-6" : ""}>{summary}</div>
      {submitLabel && (
        // Phones: total and save button stay in view above the tab bar
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur sm:-mx-5 lg:hidden">
          <div className="min-w-0 text-sm">
            <p className="font-semibold tabular-nums text-ink">{money(total, currency)}</p>
            <p className={`truncate text-xs ${balance > 0 ? "text-bad" : "text-muted"}`}>
              {balance > 0 ? `${money(balance, currency)} due later` : lines.length ? "Fully paid" : "No plan chosen"}
            </p>
          </div>
          <SubmitButton>{submitLabel}</SubmitButton>
        </div>
      )}
    </div>
  );
}
