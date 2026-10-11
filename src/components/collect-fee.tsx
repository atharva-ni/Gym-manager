"use client";

import { useState } from "react";
import { MemberSelect, type MemberOption } from "@/components/member-select";
import { addDays, fmtDate, money } from "@/lib/format";
import { label, PAYMENT_CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";

/** A membership or PT package that still has money owed on it. */
export type PendingFee = {
  id: string;
  member_id: string;
  plan_name: string;
  kind: "membership" | "personal_training";
  start_date: string;
  end_date: string;
  balance: number;
  balance_due_on: string | null;
};

const OTHER = "other";
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fields for collecting money from a member. Pick the member (or pass
 * `memberId`), choose which pending fee the money goes to, and enter the
 * full amount or a part payment. A discount can waive part of the balance.
 * "Other" covers admission, single PT sessions and anything not on a plan.
 */
export function CollectFeeFields({
  members,
  memberId: fixedMemberId,
  fees,
  currency,
  today,
  defaultFeeId,
}: {
  members?: MemberOption[];
  memberId?: string;
  fees: PendingFee[];
  currency: string;
  today: string;
  defaultFeeId?: string;
}) {
  const firstFeeOf = (id: string | null) => fees.find((f) => f.member_id === id)?.id ?? OTHER;
  const [memberId, setMemberId] = useState<string | null>(fixedMemberId ?? null);
  const [feeId, setFeeId] = useState<string>(defaultFeeId ?? firstFeeOf(fixedMemberId ?? null));
  const [amount, setAmount] = useState<string | null>(null); // null = pay the full balance
  const [waive, setWaive] = useState("");

  const memberFees = fees.filter((f) => f.member_id === memberId);
  const fee = memberFees.find((f) => f.id === feeId);
  const totalDue = memberFees.reduce((s, f) => s + Number(f.balance), 0);

  const balance = fee ? Number(fee.balance) : 0;
  const discount = Math.min(balance, Math.max(0, Number(waive) || 0));
  const payable = r2(balance - discount);
  const paying = fee ? (amount === null ? payable : Math.min(payable, Math.max(0, Number(amount) || 0))) : Number(amount) || 0;
  const remaining = fee ? r2(payable - paying) : 0;

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
          members={members ?? []}
          required
          onChange={(m) => {
            setMemberId(m?.id ?? null);
            pickFee(firstFeeOf(m?.id ?? null));
          }}
        />
      )}

      {memberId && (
        <>
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            {totalDue > 0 ? (
              <span>
                Pending fees: <span className="font-semibold text-bad">{money(totalDue, currency)}</span>
                {memberFees.length > 1 && <span className="text-muted"> across {memberFees.length} plans</span>}
              </span>
            ) : (
              <span className="text-muted">No pending fees. To charge a new plan, use Renew / add plan on the member’s profile.</span>
            )}
          </div>

          <label className="block">
            <span className="label">Pay towards</span>
            <select className="input" name="membership_id" value={feeId === OTHER ? "" : feeId} onChange={(e) => pickFee(e.target.value || OTHER)}>
              {memberFees.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.kind === "personal_training" ? "PT: " : ""}
                  {f.plan_name} ({fmtDate(f.start_date)} to {fmtDate(f.end_date)}) · due {money(f.balance, currency)}
                </option>
              ))}
              <option value="">Other payment (admission, single PT session, misc.)</option>
            </select>
          </label>
          <input type="hidden" name="category" value={fee ? fee.kind : ""} disabled={!fee} />
          {!fee && (
            <label className="block">
              <span className="label">Payment for</span>
              <select name="category" defaultValue="admission" className="input">
                {PAYMENT_CATEGORIES.filter((c) => c !== "membership").map((c) => (
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
                const active = o.key === "full" ? amount === null : o.key === "half" ? amount === String(r2(payable / 2)) : amount !== null && amount !== String(r2(payable / 2));
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
                step="0.01"
                min={fee && discount > 0 ? 0 : 0.01}
                max={fee ? payable : undefined}
                value={fee ? (amount === null ? String(payable) : amount) : (amount ?? "")}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="label">Date<span className="text-bad"> *</span></span>
              <input className="input" name="paid_on" type="date" defaultValue={today} max={today} required />
            </label>
            <label className="block">
              <span className="label">Payment mode</span>
              <select name="method" defaultValue="upi" className="input">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{label(m)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">UPI / transaction ref.</span>
              <input className="input" name="reference" placeholder="Optional" />
            </label>
            {fee && (
              <label className="block">
                <span className="label">Discount / waive off</span>
                <input
                  className="input"
                  name="waive"
                  type="number"
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
