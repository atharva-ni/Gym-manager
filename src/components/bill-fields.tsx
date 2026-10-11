"use client";

import { useState } from "react";
import { addDays, money } from "@/lib/format";
import { label, PAYMENT_METHODS } from "@/lib/constants";

type PlanOpt = {
  id: string;
  name: string;
  price: number;
  admission_fee: number;
  duration_days: number;
  sessions: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One bill: an optional gym membership plus an optional PT package, a
 * discount (₹ or %), and what is paid now. Shows a live summary and leaves
 * any unpaid amount as a balance with a due date. Mirrors the server-side
 * maths in members/actions.ts (createBill).
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
}: {
  plans: PlanOpt[];
  ptPlans: PlanOpt[];
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
}) {
  const [planId, setPlanId] = useState(ptOnly ? "" : (plans[0]?.id ?? ""));
  const [admission, setAdmission] = useState(chargeAdmission);
  const [ptOn, setPtOn] = useState(!!ptOnly);
  const [ptPlanId, setPtPlanId] = useState(ptPlans[0]?.id ?? "");
  const [discType, setDiscType] = useState<"amount" | "percent">("amount");
  const [discValue, setDiscValue] = useState("");
  const [paid, setPaid] = useState<string | null>(null); // null = follow the total

  const plan = plans.find((p) => p.id === planId);
  const pt = ptOn ? ptPlans.find((p) => p.id === ptPlanId) : undefined;
  const lines = [
    plan && { label: `${plan.name} (${plan.duration_days} days)`, amount: Number(plan.price) },
    plan && admission && Number(plan.admission_fee) > 0 && { label: "Admission fee", amount: Number(plan.admission_fee) },
    pt && { label: `PT: ${pt.name}${pt.sessions ? ` (${pt.sessions} sessions)` : ""}`, amount: Number(pt.price) },
  ].filter(Boolean) as { label: string; amount: number }[];

  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const dv = Number(discValue) || 0;
  const discount = Math.min(subtotal, Math.max(0, r2(discType === "percent" ? (subtotal * dv) / 100 : dv)));
  const total = r2(subtotal - discount);
  const paidNow = paid === null ? total : Math.min(total, Math.max(0, Number(paid) || 0));
  const balance = r2(total - paidNow);

  return (
    <div className="space-y-4">
      {/* Items */}
      {!ptOnly && (
      <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Gym membership</span>
          <select name="plan_id" className="input" value={planId} onChange={(e) => { setPlanId(e.target.value); setPaid(null); }}>
            <option value="">No membership on this bill</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.price, currency)} / {p.duration_days}d
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Membership starts</span>
          <input type="date" name="start_date" className="input" defaultValue={startDate} disabled={!plan} />
        </label>
      </div>
      {plan && Number(plan.admission_fee) > 0 && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            name="include_admission"
            checked={admission}
            onChange={(e) => { setAdmission(e.target.checked); setPaid(null); }}
            className="size-4 accent-[var(--brand)]"
          />
          Charge admission fee ({money(plan.admission_fee, currency)})
        </label>
      )}
      </>
      )}

      {ptPlans.length > 0 && (
        <div className={ptOnly ? "" : "rounded-lg border border-line p-3"}>
          {!ptOnly && (
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={ptOn} onChange={(e) => { setPtOn(e.target.checked); setPaid(null); }} className="size-4 accent-[var(--brand)]" />
              Add personal training
            </label>
          )}
          {ptOn && (
            <div className={`grid gap-4 sm:grid-cols-3 ${ptOnly ? "" : "mt-3"}`}>
              <label className="block">
                <span className="label">PT package</span>
                <select name="pt_plan_id" className="input" value={ptPlanId} onChange={(e) => { setPtPlanId(e.target.value); setPaid(null); }} required>
                  {ptPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {money(p.price, currency)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Trainer<span className="text-bad"> *</span></span>
                <select name="trainer_id" className="input" defaultValue={defaultTrainerId ?? ""} required>
                  <option value="">Select trainer</option>
                  {trainers.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">PT starts</span>
                <input type="date" name="pt_start_date" className="input" defaultValue={ptStartDate} />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Discount */}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <label className="block">
          <span className="label">Discount</span>
          <input
            name="discount_value"
            type="number"
            min={0}
            step="0.01"
            max={discType === "percent" ? 100 : undefined}
            className="input"
            placeholder="0"
            value={discValue}
            onChange={(e) => { setDiscValue(e.target.value); setPaid(null); }}
          />
        </label>
        <label className="block">
          <span className="label">Type</span>
          <select
            name="discount_type"
            className="input"
            value={discType}
            onChange={(e) => { setDiscType(e.target.value as "amount" | "percent"); setPaid(null); }}
          >
            <option value="amount">₹ off</option>
            <option value="percent">% off</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Reason</span>
          <input name="discount_reason" className="input" placeholder="e.g. Diwali offer, couple, student" />
        </label>
      </div>

      {/* Payment */}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="label">Paid now</span>
          <input
            name="amount_paid"
            type="number"
            min={0}
            max={total}
            step="0.01"
            className="input"
            value={paid === null ? String(total) : paid}
            onChange={(e) => setPaid(e.target.value)}
          />
          <span className="mt-1 flex gap-2 text-xs">
            <button type="button" className="text-brand" onClick={() => setPaid(null)}>Full</button>
            <button type="button" className="text-brand" onClick={() => setPaid(String(r2(total / 2)))}>Half</button>
            <button type="button" className="text-brand" onClick={() => setPaid("0")}>Nothing now</button>
          </span>
        </label>
        <label className="block">
          <span className="label">Payment mode</span>
          <select name="method" className="input" defaultValue="upi">
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{label(m)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">UPI / transaction ref.</span>
          <input name="reference" className="input" placeholder="Optional" />
        </label>
      </div>
      {balance > 0 && (
        <label className="block sm:w-1/3">
          <span className="label">Balance due by</span>
          <input type="date" name="balance_due_on" className="input" min={today} defaultValue={addDays(today, 7)} />
        </label>
      )}

      {/* Summary */}
      <div className="rounded-lg bg-surface-2 p-4 text-sm">
        {lines.length === 0 ? (
          <p className="text-muted">Choose a membership and/or personal training to build the bill.</p>
        ) : (
          <dl className="space-y-1.5">
            {lines.map((l) => (
              <div key={l.label} className="flex justify-between gap-4">
                <dt className="text-ink-2">{l.label}</dt>
                <dd className="tabular-nums">{money(l.amount, currency)}</dd>
              </div>
            ))}
            {discount > 0 && (
              <div className="flex justify-between gap-4 text-good">
                <dt>Discount{discType === "percent" && dv ? ` (${dv}%)` : ""}</dt>
                <dd className="tabular-nums">- {money(discount, currency)}</dd>
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
    </div>
  );
}
