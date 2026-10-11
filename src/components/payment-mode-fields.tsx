"use client";

import { useState } from "react";
import { label, PAYMENT_METHODS } from "@/lib/constants";
import { money } from "@/lib/format";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Payment mode, or a split across two modes (e.g. ₹2,000 cash + ₹3,000 UPI).
 * Posts `method`, `reference` and, when split, `split_payment`, `method2`, `amount2`.
 */
export function PaymentModeFields({ total, currency }: { total: number; currency: string }) {
  const [split, setSplit] = useState(false);
  const [method, setMethod] = useState("upi");
  const [second, setSecond] = useState("");
  const amount2 = Math.min(total, Math.max(0, Number(second) || 0));
  const first = r2(total - amount2);
  const otherMode = PAYMENT_METHODS.find((m) => m !== method) ?? "cash";

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">{split ? "First payment mode" : "Payment mode"}</span>
          <select name="method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{label(m)}</option>
            ))}
          </select>
          {split && <span className="mt-1 block text-xs text-muted">{money(first, currency)} by {label(method)}</span>}
        </label>
        <label className="block">
          <span className="label">UPI / transaction ref.</span>
          <input name="reference" className="input" placeholder="Optional" />
        </label>
      </div>
      {total > 0 && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            name="split_payment"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
            className="size-4 accent-[var(--brand)]"
          />
          Paid using two modes (e.g. part cash, part UPI)
        </label>
      )}
      {split && (
        <div className="grid gap-4 rounded-lg border border-line p-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Second payment mode</span>
            <select name="method2" className="input" defaultValue={otherMode === "upi" ? "upi" : "cash"} key={method}>
              {PAYMENT_METHODS.filter((m) => m !== method).map((m) => (
                <option key={m} value={m}>{label(m)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Amount by second mode</span>
            <input
              name="amount2"
              type="number"
              step="0.01"
              min={0.01}
              max={Math.max(0.01, r2(total - 0.01))}
              className="input"
              value={second}
              onChange={(e) => setSecond(e.target.value)}
              required
            />
          </label>
        </div>
      )}
    </div>
  );
}
