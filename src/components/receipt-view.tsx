import type { ReactNode } from "react";
import { fmtDate, money } from "@/lib/format";

export type ReceiptData = {
  title: string;
  number: string;
  date: string;
  gym: { gym_name: string; address: string | null; phone: string | null; email: string | null; currency: string; tax_rate: number };
  member: { full_name: string; member_code: string } | null;
  mode?: string | null;
  items: { label: string; sub?: string | null; fee?: number | null; amount: number }[];
  totalLabel: string;
  total: number;
  /** Still owed on the plans in this receipt (payments only). */
  balance?: number | null;
  balanceDueOn?: string | null;
  notes?: string | null;
};

/** Printable receipt / refund note, shared by the internal and public pages. */
export function ReceiptView({ r, actions }: { r: ReceiptData; actions?: ReactNode }) {
  const { currency } = r.gym;
  const showFee = r.items.some((i) => i.fee !== undefined && i.fee !== null);
  const tax = Number(r.gym.tax_rate);
  return (
    <main className="min-h-screen bg-bg px-4 py-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 print:border-0 print:text-black">
        <div className="border-b border-line pb-4 text-center">
          <h1 className="text-xl font-semibold">{r.gym.gym_name}</h1>
          {r.gym.address && <p className="text-sm text-muted">{r.gym.address}</p>}
          <p className="text-sm text-muted">{[r.gym.phone, r.gym.email].filter(Boolean).join(" · ")}</p>
        </div>
        <h2 className="mt-5 text-center text-sm font-semibold uppercase tracking-widest text-muted">{r.title}</h2>

        <dl className="mt-5 space-y-2 text-sm">
          {[
            ["Number", r.number],
            ["Date", fmtDate(r.date)],
            ...(r.member ? [["Member", `${r.member.full_name} (${r.member.member_code})`]] : []),
            ...(r.mode ? [["Mode", r.mode]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>

        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 font-medium">Item</th>
              {showFee && <th className="py-2 text-right font-medium">Fee</th>}
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((i, n) => (
              <tr key={n} className="border-b border-line align-top">
                <td className="py-2 pr-2">
                  {i.label}
                  {i.sub && <span className="block text-xs text-muted">{i.sub}</span>}
                </td>
                {showFee && <td className="py-2 text-right tabular-nums">{i.fee !== undefined && i.fee !== null ? money(i.fee, currency) : "-"}</td>}
                <td className="py-2 text-right tabular-nums">{money(i.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between">
          <span className="font-medium">{r.totalLabel}</span>
          <span className="text-2xl font-semibold tabular-nums">{money(r.total, currency)}</span>
        </div>
        {tax > 0 && r.total > 0 && (
          <p className="mt-1 text-right text-xs text-muted">
            Includes GST @ {tax}%: {money(r.total - r.total / (1 + tax / 100), currency)}
          </p>
        )}
        {r.balance !== undefined && r.balance !== null && (
          <div className="mt-3 flex justify-between rounded-lg bg-surface-2 p-3 text-sm font-semibold print:bg-transparent print:p-0">
            <span>Balance due</span>
            <span className="tabular-nums">
              {r.balance > 0 ? `${money(r.balance, currency)}${r.balanceDueOn ? ` by ${fmtDate(r.balanceDueOn)}` : ""}` : "Nil (fully paid)"}
            </span>
          </div>
        )}
        {r.notes && <p className="mt-4 text-sm text-muted">{r.notes}</p>}
        <p className="mt-8 text-center text-xs text-muted">This is a computer-generated document. Thank you for training with us!</p>
      </div>
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2 print:hidden">{actions}</div>}
    </main>
  );
}
