import { notFound } from "next/navigation";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { label } from "@/lib/constants";
import { siteUrl } from "@/lib/site";
import { waLink } from "@/lib/whatsapp";
import type { MembershipBalance, Payment } from "@/lib/types";
import { ReceiptView, type ReceiptData } from "@/components/receipt-view";
import { PrintButton } from "./print-button";

export const metadata = { title: "Receipt · SetFit Fitness" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Member = { full_name: string; member_code: string; phone: string | null } | null;

/**
 * Printable receipt for a bill (all payments sharing a receipt number), a
 * counter sale (S-00001) or a refund note (RF-00001). Opened by number or id.
 */
export default async function ReceiptPage(props: PageProps<"/receipt/[id]">) {
  const { id: raw } = await props.params;
  const id = decodeURIComponent(raw);
  const settings = await getSettings();
  const sb = await createClient();
  const gym = settings;
  let data: ReceiptData;
  let share: { phone: string | null | undefined; token: string; no: string } | null = null;

  if (id.startsWith("S-")) {
    const { data: sale } = await sb.from("sales").select("*, members(full_name, member_code, phone)").eq("receipt_no", id).maybeSingle();
    if (!sale) notFound();
    const member = sale.members as Member;
    data = {
      title: "Sale receipt",
      number: sale.receipt_no,
      date: sale.sold_on,
      gym,
      member,
      mode: sale.on_credit ? "Added to dues" : label(sale.method),
      items: [{ label: `${sale.product_name} x ${sale.quantity}`, amount: Number(sale.total) }],
      totalLabel: sale.on_credit ? "Amount added to dues" : "Amount received",
      total: Number(sale.total),
    };
    share = { phone: member?.phone, token: sale.share_token, no: sale.receipt_no };
  } else if (id.startsWith("RF-")) {
    const { data: ref } = await sb
      .from("refunds")
      .select("*, members(full_name, member_code, phone), memberships(plan_name, start_date, end_date)")
      .eq("refund_no", id)
      .maybeSingle();
    if (!ref) notFound();
    const plan = ref.memberships as { plan_name: string; start_date: string; end_date: string } | null;
    data = {
      title: "Refund note",
      number: ref.refund_no,
      date: ref.refunded_on,
      gym: { ...gym, tax_rate: 0 },
      member: ref.members as Member,
      mode: label(ref.method),
      items: [
        {
          label: plan ? `Refund on ${plan.plan_name}` : "Refund",
          sub: plan ? `${fmtDate(plan.start_date)} to ${fmtDate(plan.end_date)}` : null,
          amount: Number(ref.amount),
        },
      ],
      totalLabel: "Amount refunded",
      total: Number(ref.amount),
      notes: ref.reason,
    };
  } else {
    const select = "*, members(full_name, member_code, phone)";
    const { data: first } = UUID.test(id)
      ? await sb.from("payments").select(select).eq("id", id).maybeSingle()
      : await sb.from("payments").select(select).eq("receipt_no", id).limit(1).maybeSingle();
    if (!first) notFound();
    const { data: group } = first.receipt_no
      ? await sb.from("payments").select("*").eq("receipt_no", first.receipt_no).order("created_at")
      : { data: [first] };
    const payments = (group ?? [first]) as Payment[];
    const feeIds = payments.map((p) => p.membership_id).filter(Boolean) as string[];
    const { data: feeRows } = feeIds.length ? await sb.from("membership_balances").select("*").in("id", feeIds) : { data: [] };
    const fees = new Map(((feeRows ?? []) as MembershipBalance[]).map((f) => [f.id, f]));
    const owed = [...fees.values()].filter((f) => f.status !== "cancelled");
    const member = first.members as Member;
    data = {
      title: "Payment receipt",
      number: first.receipt_no ?? first.id.slice(0, 8).toUpperCase(),
      date: first.paid_on,
      gym,
      member,
      mode: [...new Set(payments.map((p) => label(p.method)))].join(" + ") + (first.reference ? ` · Ref ${first.reference}` : ""),
      items: payments.map((p) => {
        const fee = p.membership_id ? fees.get(p.membership_id) : undefined;
        return {
          label: fee ? `${fee.kind === "personal_training" ? "Personal training: " : ""}${fee.plan_name}` : label(p.category),
          sub:
            fee && fee.kind !== "charge"
              ? `${fmtDate(fee.start_date)} to ${fmtDate(fee.end_date)}${payments.length > 1 ? ` · ${label(p.method)}` : ""}`
              : null,
          fee: fee ? Number(fee.price) - Number(fee.discount) : null,
          amount: Number(p.amount),
        };
      }),
      totalLabel: "Amount received",
      total: payments.reduce((s, p) => s + Number(p.amount), 0),
      balance: fees.size ? owed.reduce((s, f) => s + Number(f.balance), 0) : null,
      balanceDueOn: owed.map((f) => f.balance_due_on).filter(Boolean).sort()[0] ?? null,
      notes: first.notes,
    };
    share = { phone: member?.phone, token: first.share_token, no: data.number };
  }

  const site = await siteUrl();
  const wa = share
    ? waLink(share.phone, `Hi ${data.member?.full_name ?? ""}, here is your receipt ${share.no} from ${gym.gym_name}: ${site}/r/${share.token}`)
    : null;

  return (
    <ReceiptView
      r={data}
      actions={
        <>
          <PrintButton />
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary text-good">
              <Send size={16} /> Send on WhatsApp
            </a>
          )}
        </>
      }
    />
  );
}
