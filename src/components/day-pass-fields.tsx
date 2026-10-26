"use client";

import { useState, useTransition } from "react";
import { membersWithPhone } from "@/app/actions";
import { label, PAYMENT_METHODS } from "@/lib/constants";
import { money } from "@/lib/format";

type Pass = { id: string; name: string; price: number; duration_days: number };

/**
 * Sell a day pass / trial. The mobile number is looked up first: a returning
 * visitor or member is reused, otherwise a name is needed for a new record.
 */
export function DayPassFields({ passes, currency }: { passes: Pass[]; currency: string }) {
  const [planId, setPlanId] = useState(passes[0]?.id ?? "");
  const [amount, setAmount] = useState<string | null>(null);
  const [match, setMatch] = useState<{ full_name: string; member_code: string } | null>(null);
  const [checked, setChecked] = useState("");
  const [looking, startLookup] = useTransition();
  const pass = passes.find((p) => p.id === planId);

  const lookup = (phone: string) => {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (digits.length < 10 || digits === checked) return;
    startLookup(async () => {
      const found = await membersWithPhone(phone);
      setMatch(found[0] ?? null);
      setChecked(digits);
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Mobile number<span className="text-bad"> *</span></span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            className="input"
            placeholder="98765 43210"
            required
            onBlur={(e) => lookup(e.target.value)}
            onChange={() => {
              setMatch(null);
              setChecked("");
            }}
          />
          {looking && <span className="mt-1 block text-xs text-muted">Checking…</span>}
          {match && (
            <span className="mt-1 block text-xs text-good">
              Returning visitor: {match.full_name} ({match.member_code})
            </span>
          )}
        </label>
        {!match && (
          <label className="block">
            <span className="label">Name{checked && <span className="text-bad"> *</span>}</span>
            <input name="full_name" className="input" placeholder="New visitor's name" required={!!checked} />
          </label>
        )}
        <label className="block">
          <span className="label">Pass</span>
          <select
            name="plan_id"
            className="input"
            value={planId}
            onChange={(e) => {
              setPlanId(e.target.value);
              setAmount(null);
            }}
          >
            {passes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.price, currency)} / {p.duration_days}d
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Amount paid</span>
          <input
            name="amount_paid"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            max={pass ? Number(pass.price) : undefined}
            className="input"
            value={amount ?? String(pass ? Number(pass.price) : 0)}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted">Enter 0 for a free trial.</span>
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
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="check_in" defaultChecked className="size-4 accent-[var(--brand)]" />
        Check them in now
      </label>
    </div>
  );
}
