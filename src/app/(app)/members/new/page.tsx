import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings, requireOwner } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import type { Plan } from "@/lib/types";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { BillFields } from "@/components/bill-fields";
import { MemberFields } from "../member-fields";
import { createMember } from "../actions";

export const metadata = { title: "New admission · SetFit Fitness" };

export default async function NewMemberPage(props: PageProps<"/members/new">) {
  const { lead: leadId } = await props.searchParams;
  await requireOwner(); // staff are sent to check-in
  const settings = await getSettings();
  const today = todayISO(settings.timezone);
  const sb = await createClient();
  const [{ data: trainers }, { data: planRows }, { data: lead }] = await Promise.all([
    sb.from("trainers").select("id, full_name").eq("status", "active").order("full_name"),
    sb.from("plans").select("*").eq("is_active", true).order("price"),
    typeof leadId === "string"
      ? sb.from("leads").select("id, full_name, phone, email, interest, notes").eq("id", leadId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const plans = (planRows ?? []) as Plan[];
  const gymPlans = plans.filter((p) => p.kind === "membership");
  const ptPlans = plans.filter((p) => p.kind === "personal_training");

  return (
    <>
      <PageHeader
        title="New admission"
        description="Add the member, choose their plan (and personal training if they want it), and take payment in one go."
      />
      {lead && (
        <p className="mb-4 rounded-lg border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand">
          Converting lead <span className="font-semibold">{lead.full_name}</span>
          {lead.interest ? ` (interested in ${lead.interest})` : ""}. Saving marks the lead as converted.
        </p>
      )}
      <ActionForm action={createMember} className="space-y-6">
        <Card title="1. Member">
          <div className="space-y-4">
            {lead && <input type="hidden" name="lead_id" value={lead.id} />}
            <MemberFields
              trainers={trainers ?? []}
              today={today}
              defaults={lead ? { full_name: lead.full_name, phone: lead.phone, email: lead.email, notes: lead.notes } : undefined}
            />
          </div>
        </Card>
        <Card title="2. Plan & payment">
          {!plans.length ? (
            <p className="text-sm text-muted">
              No active plans yet. <Link href="/plans" className="text-brand underline">Create a plan</Link> first, or save the member now and bill later.
            </p>
          ) : (
            <BillFields
              plans={gymPlans}
              ptPlans={ptPlans}
              trainers={trainers ?? []}
              currency={settings.currency}
              today={today}
              startDate={today}
              ptStartDate={today}
            />
          )}
        </Card>
        <div className="flex justify-end gap-2">
          <Link href="/members" className="btn-secondary">
            Cancel
          </Link>
          <SubmitButton>Save admission</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
