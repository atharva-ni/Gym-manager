import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { fmtDate, money } from "@/lib/format";
import { label } from "@/lib/constants";
import type { MembershipBalance, Payment } from "@/lib/types";
import { PrintButton } from "./print-button";

export const metadata = { title: "Receipt · SetFit Fitness" };

type Fee = Pick<
  MembershipBalance,
  "id" | "plan_name" | "kind" | "start_date" | "end_date" | "price" | "discount" | "paid" | "balance" | "balance_due_on"
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A receipt for one bill: all payments sharing a receipt number (or a single payment). */
export default async function ReceiptPage(props: PageProps<"/receipt/[id]">) {
  const { id } = await props.params;
  const settings = await getSettings();
  const { currency } = settings;
  const sb = await createClient();

  const select = "*, members(full_name, member_code, phone)";
  const { data: first } = UUID.test(id)
    ? await sb.from("payments").select(select).eq("id", id).maybeSingle()
    : await sb.from("payments").select(select).eq("receipt_no", decodeURIComponent(id)).limit(1).maybeSingle();
  if (!first) notFound();

  const { data: group } = first.receipt_no
    ? await sb.from("payments").select("*").eq("receipt_no", first.receipt_no).order("created_at")
    : { data: [first] };
  const payments = (group ?? [first]) as Payment[];
  const total = payments.reduce((s, p) => s + Number(p.amount), 0);

  const feeIds = payments.map((p) => p.membership_id).filter(Boolean) as string[];
  const { data: feeRows } = feeIds.length
    ? await sb
        .from("membership_balances")
        .select("id, plan_name, kind, start_date, end_date, price, discount, paid, balance, balance_due_on")
        .in("id", feeIds)
    : { data: [] };
  const fees = new Map(((feeRows ?? []) as Fee[]).map((f) => [f.id, f]));
  const anyBalance = [...fees.values()].reduce((s, f) => s + Number(f.balance), 0);
  const nextDue = [...fees.values()].map((f) => f.balance_due_on).filter(Boolean).sort()[0];

  const header: [string, string][] = [
    ["Receipt no.", first.receipt_no ?? first.id.slice(0, 8).toUpperCase()],
    ["Date", fmtDate(first.paid_on)],
    ["Received from", first.members ? `${first.members.full_name} (${first.members.member_code})` : "Member"],
    ...(first.members?.phone ? ([["Phone", first.members.phone]] as [string, string][]) : []),
    ["Payment mode", `${label(first.method)}${first.reference ? ` · Ref ${first.reference}` : ""}`],
  ];

  return (
    <main className="min-h-screen bg-bg px-4 py-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 print:border-0 print:text-black">
        <div className="border-b border-line pb-4 text-center">
          <h1 className="text-xl font-semibold">{settings.gym_name}</h1>
          {settings.address && <p className="text-sm text-muted">{settings.address}</p>}
          <p className="text-sm text-muted">{[settings.phone, settings.email].filter(Boolean).join(" · ")}</p>
        </div>
        <h2 className="mt-5 text-center text-sm font-semibold uppercase tracking-widest text-muted">Payment receipt</h2>

        <dl className="mt-5 space-y-2 text-sm">
          {header.map(([k, v]) => (
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
              <th className="py-2 text-right font-medium">Fee</th>
              <th className="py-2 text-right font-medium">Paid now</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const fee = p.membership_id ? fees.get(p.membership_id) : undefined;
              return (
                <tr key={p.id} className="border-b border-line align-top">
                  <td className="py-2 pr-2">
                    {fee ? (
                      <>
                        {fee.kind === "personal_training" ? "Personal training: " : ""}
                        {fee.plan_name}
                        <span className="block text-xs text-muted">
                          {fmtDate(fee.start_date)} to {fmtDate(fee.end_date)}
                        </span>
                      </>
                    ) : (
                      label(p.category)
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {fee ? (
                      <>
                        {money(Number(fee.price) - Number(fee.discount), currency)}
                        {Number(fee.discount) > 0 && (
                          <span className="block text-xs text-muted">after {money(fee.discount, currency)} off</span>
                        )}
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(p.amount, currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between">
          <span className="font-medium">Amount received</span>
          <span className="text-2xl font-semibold tabular-nums">{money(total, currency)}</span>
        </div>
        {Number(settings.tax_rate) > 0 && (
          <p className="mt-1 text-right text-xs text-muted">
            Includes GST @ {Number(settings.tax_rate)}%: {money(total - total / (1 + Number(settings.tax_rate) / 100), currency)}
          </p>
        )}
        {fees.size > 0 && (
          <div className="mt-3 flex justify-between rounded-lg bg-surface-2 p-3 text-sm font-semibold print:bg-transparent print:p-0">
            <span>Balance due</span>
            <span className="tabular-nums">
              {anyBalance > 0 ? `${money(anyBalance, currency)}${nextDue ? ` by ${fmtDate(nextDue)}` : ""}` : "Nil (fully paid)"}
            </span>
          </div>
        )}
        {first.notes && <p className="mt-4 text-sm text-muted">{first.notes}</p>}
        <p className="mt-8 text-center text-xs text-muted">This is a computer-generated receipt. Thank you for training with us!</p>
      </div>
      <div className="mt-6 text-center print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}
