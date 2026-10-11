import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { label } from "@/lib/constants";
import { ReceiptView, type ReceiptData } from "@/components/receipt-view";
import { PrintButton } from "../../receipt/[id]/print-button";

export const metadata = { title: "Receipt", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Shared = {
  type: "payment" | "sale";
  receipt_no: string | null;
  date: string;
  method: string;
  reference?: string | null;
  gym: ReceiptData["gym"];
  member: ReceiptData["member"];
  items: { label: string; kind?: string | null; start_date?: string | null; end_date?: string | null; fee: number | null; amount: number }[];
  balance: number;
};

/**
 * Receipt opened from a link sent to the member (no login). The token is
 * checked by the public_receipt database function, which returns only what
 * the receipt shows.
 */
export default async function SharedReceiptPage(props: PageProps<"/r/[token]">) {
  const { token } = await props.params;
  if (!UUID.test(token)) notFound();
  const sb = await createClient();
  const { data } = await sb.rpc("public_receipt", { p_token: token });
  const r = data as Shared | null;
  if (!r || !r.gym) notFound();

  const view: ReceiptData = {
    title: r.type === "sale" ? "Sale receipt" : "Payment receipt",
    number: r.receipt_no ?? "-",
    date: r.date,
    gym: r.gym,
    member: r.member,
    mode: `${label(r.method)}${r.reference ? ` · Ref ${r.reference}` : ""}`,
    items: (r.items ?? []).map((i) => ({
      label: `${i.kind === "personal_training" ? "Personal training: " : ""}${i.label}`,
      sub: i.start_date && i.kind !== "charge" ? `${fmtDate(i.start_date)} to ${fmtDate(i.end_date)}` : null,
      fee: i.fee,
      amount: Number(i.amount),
    })),
    totalLabel: r.type === "sale" && Number(r.balance) > 0 ? "Amount added to dues" : "Amount received",
    total: r.type === "sale" && Number(r.balance) > 0 ? Number(r.balance) : (r.items ?? []).reduce((s, i) => s + Number(i.amount), 0),
    balance: r.type === "payment" ? Number(r.balance) : null,
  };
  return <ReceiptView r={view} actions={<PrintButton />} />;
}
