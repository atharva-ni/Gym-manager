"use client";

import { useState, useTransition } from "react";
import { MemberSelect } from "@/components/member-select";
import { PaymentModeFields } from "@/components/payment-mode-fields";
import { pendingFeesFor } from "@/app/actions";
import { addDays, fmtDate, money } from "@/lib/format";
import { label, PAYMENT_CATEGORIES } from "@/lib/constants";
import { allocateAcrossFees } from "@/lib/billing";

/** A membership or PT package that still has money owed on it. */
export type PendingFee = {
  id: string;
  member_id: string;
  plan_name: string;
  kind: "membership" | "personal_training" | "pass" | "charge";
  start_date: string;
  end_date: string;
  balance: number;
  balance_due_on: string | null;
};

const OTHER = "other";
/** One payment spread over every pending fee, oldest first. */
const ALL = "all";
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fields for collecting money from a member. Pass `memberId` + `fees` for a
 * known member, or nothing to show a member search (fees then load for the
 * member picked). Full or part payment, optional discount / waive-off, and
 * one or two payment modes. With two or more fees pending, "All pending
 * fees" pays them oldest first on one receipt. "Other" covers single PT
 * sessions and anything not on a bill.
 */
export function CollectFeeFields({
  memberId: fixedMemberId,
  fees: initialFees = [],
  currency,
  today,
  defaultFeeId,
}: {
  memberId?: string;
  fees?: PendingFee[];
  currency: string;
  today: string;
  defaultFeeId?: string;
}) {
  const [memberId, setMemberId] = useState<string | null>(fixedMemberId ?? null);
  const [fees, setFees] = useState<PendingFee[]>(initialFees);
  const firstChoice = (list: PendingFee[]) => (list.length > 1 ? ALL : (list[0]?.id ?? OTHER));
  const [feeId, setFeeId] = useState<string>(defaultFeeId ?? firstChoice(initialFees));
  const [amount, setAmount] = useState<string | null>(null); // null = pay the full balance
  const [waive, setWaive] = useState("");
  const [loading, startLoading] = useTransition();

  const all = feeId === ALL && fees.length > 1;
  const totalDue = r2(fees.reduce((s, f) => s + Number(f.balance), 0));
  // "All pending fees" behaves like one big fee with no discount
  const fee: PendingFee | undefined = all
    ? { id: ALL, member_id: memberId ?? "", plan_name: "All pending fees", kind: "membership", start_date: "", end_date: "", balance: totalDue, balance_due_on: null }
    : fees.find((f) => f.id === feeId);
  const balance = fee ? Number(fee.balance) : 0;
  const discount = Math.min(balance, Math.max(0, Number(waive) || 0));
  const payable = r2(balance - discount);
  const paying = fee ? (amount === null ? payable : Math.min(payable, Math.max(0, Number(amount) || 0))) : Number(amount) || 0;
  const remaining = fee ? r2(payable - paying) : 0;
  const split = all ? allocateAcrossFees(paying, fees.map((f) => Number(f.balance))) : [];

  const pickFee = (id: string) => {
    setFeeId(id);
    setAmount(null);
    setWaive("");
  };

  return (
    <>
      {fixedMemberId ? (
        <input type="hidden" name="member_id" value={fixedMemberId} />
      ) : (
        <MemberSelect
          required
          onChange={(m) => {
            setMemberId(m?.id ?? null);
            setFees([]);
            pickFee(OTHER);
            if (m) {
              startLoading(async () => {
                const list = await pendingFeesFor(m.id);
                setFees(list);
                pickFee(firstChoice(list));
              });
            }
          }}
        />
      )}

      {memberId && loading && <p className="text-sm text-muted">Loading pending fees…</p>}
      {memberId && !loading && (
        <>
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            {totalDue > 0 ? (
              <span>
                Pending fees: <span className="font-semibold text-bad">{money(totalDue, currency)}</span>
                {fees.length > 1 && <span className="text-muted"> across {fees.length} plans</span>}
              </span>
            ) : (
              <span className="text-muted">No pending fees. To charge a new plan, use Renew / add plan on the member’s profile.</span>
            )}
          </div>

          <label className="block">
            <span className="label">Pay towards</span>
            <input type="hidden" name="membership_id" value={fee && !all ? fee.id : ""} />
            <input type="hidden" name="pay_all" value={all ? "1" : ""} />
            <select className="input" value={feeId} onChange={(e) => pickFee(e.target.value)}>
              {fees.length > 1 && <option value={ALL}>All pending fees · {money(totalDue, currency)}</option>}
              {fees.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.kind === "personal_training" ? "PT: " : f.kind === "charge" ? "Due: " : ""}
                  {f.plan_name} · due {money(f.balance, currency)}
                  {f.kind === "charge" ? "" : ` (till ${fmtDate(f.end_date)})`}
                </option>
              ))}
              <option value={OTHER}>Other payment (single PT session, misc.)</option>
            </select>
          </label>
          <input type="hidden" name="category" value={fee ? (fee.kind === "personal_training" ? "personal_training" : "membership") : ""} disabled={!fee} />
          {!fee && (
            <label className="block">
              <span className="label">Payment for</span>
              <select name="category" defaultValue="other" className="input">
                {PAYMENT_CATEGORIES.filter((c) => c !== "membership" && c !== "admission").map((c) => (
                  <option key={c} value={c}>{label(c)}</option>
                ))}
              </select>
            </label>
          )}

          {fee && (
            <div className="flex flex-wrap gap-2">
              {[
                { key: "full", text: `Full ${money(payable, currency)}`, value: null as string | null },
                { key: "half", text: "Half", value: String(r2(payable / 2)) },
                { key: "custom", text: "Part payment", value: amount ?? "" },
              ].map((o) => {
                const half = String(r2(payable / 2));
                const active = o.key === "full" ? amount === null : o.key === "half" ? amount === half : amount !== null && amount !== half;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setAmount(o.value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      active ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:bg-surface-2"
                    }`}
                  >
                    {o.text}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Amount paying now<span className="text-bad"> *</span></span>
              <input
                className="input"
                name="amount"
                type="number"
            inputMode="decimal"
                step="0.01"
                min={fee && discount > 0 ? 0 : 0.01}
                max={fee ? payable : undefined}
                value={fee ? (amount === null ? String(payable) : amount) : (amount ?? "")}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="label">Payment date<span className="text-bad"> *</span></span>
              <input className="input" name="paid_on" type="date" defaultValue={today} max={today} required />
            </label>
            {fee && !all && (
              <label className="block">
                <span className="label">Discount / waive off</span>
                <input
                  className="input"
                  name="waive"
                  type="number"
            inputMode="decimal"
                  step="0.01"
                  min={0}
                  max={balance}
                  placeholder="0"
                  value={waive}
                  onChange={(e) => {
                    setWaive(e.target.value);
                    setAmount(null);
                  }}
                />
              </label>
            )}
            {fee && remaining > 0 && (
              <label className="block">
                <span className="label">Rest {money(remaining, currency)} due by</span>
                <input
                  className="input"
                  name="next_due_on"
                  type="date"
                  min={today}
                  defaultValue={fee.balance_due_on && fee.balance_due_on >= today ? fee.balance_due_on : addDays(today, 7)}
                  required
                />
              </label>
            )}
          </div>

          <PaymentModeFields total={paying} currency={currency} />

          {all && (
            <ul className="space-y-1 rounded-lg border border-line p-3 text-sm">
              {fees.map((f, i) => {
                const left = r2(Number(f.balance) - split[i]);
                return (
                  <li key={f.id} className="flex justify-between gap-3">
                    <span className="min-w-0 text-ink-2">
                      {f.kind === "personal_training" ? "PT: " : ""}
                      {f.plan_name} <span className="text-muted">({money(f.balance, currency)})</span>
                    </span>
                    <span className={`shrink-0 tabular-nums ${left > 0 ? "text-bad" : "text-good"}`}>
                      {split[i] > 0 ? money(split[i], currency) : "-"}
                      {left > 0 ? ` · ${money(left, currency)} left` : " · paid"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {fee && (
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              <div className="flex justify-between"><span className="text-ink-2">Pending</span><span className="tabular-nums">{money(balance, currency)}</span></div>
              {discount > 0 && (
                <div className="flex justify-between text-good"><span>Discount / waived</span><span className="tabular-nums">- {money(discount, currency)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-ink-2">Paying now</span><span className="tabular-nums">- {money(paying, currency)}</span></div>
              <div className={`mt-1 flex justify-between border-t border-line pt-1 font-semibold ${remaining > 0 ? "text-bad" : "text-good"}`}>
                <span>Balance after this</span>
                <span className="tabular-nums">{remaining > 0 ? money(remaining, currency) : "Fully paid"}</span>
              </div>
            </div>
          )}

          <label className="block">
            <span className="label">Notes</span>
            <textarea className="input" name="notes" rows={2} />
          </label>
        </>
      )}
    </>
  );
}
