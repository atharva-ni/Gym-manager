import Link from "next/link";
import { Pencil, Plus, Trash2, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { fmtDate, localDate, todayISO } from "@/lib/format";
import { label, LEAD_SOURCES, LEAD_STATUSES, options } from "@/lib/constants";
import type { Lead } from "@/lib/types";
import { Badge, Card, Empty, PageHeader, Stat, StatusBadge, TableWrap, Tabs } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { SimpleBarChart } from "@/components/charts";
import { deleteRecord } from "@/app/actions";
import { saveLead, setLeadStatus } from "./actions";

export const metadata = { title: "Leads · SetFit Fitness" };

const OPEN = ["new", "contacted", "trial"];
const NEXT: Record<string, string> = { new: "contacted", contacted: "trial" };

function LeadFields({ l, today }: { l?: Lead; today: string }) {
  return (
    <>
      <Hidden name="id" value={l?.id} />
      <Grid>
        <Field label="Full name" name="full_name" defaultValue={l?.full_name} required />
        <Field label="Phone" name="phone" type="tel" defaultValue={l?.phone ?? ""} />
        <Field label="Email" name="email" type="email" defaultValue={l?.email ?? ""} />
        <SelectField label="Source" name="source" defaultValue={l?.source ?? "walk_in"} options={options(LEAD_SOURCES)} />
        <Field label="Interested in" name="interest" defaultValue={l?.interest ?? ""} placeholder="Weight loss, PT, yoga…" />
        <SelectField label="Stage" name="status" defaultValue={l?.status ?? "new"} options={options(LEAD_STATUSES)} />
        <Field label="Follow up on" name="follow_up_on" type="date" defaultValue={l?.follow_up_on ?? today} />
      </Grid>
      <TextArea label="Notes" name="notes" rows={3} defaultValue={l?.notes} />
    </>
  );
}

export default async function LeadsPage(props: PageProps<"/leads">) {
  const sp = await props.searchParams;
  const view = typeof sp.view === "string" ? sp.view : "open";
  const settings = await getSettings();
  const today = todayISO(settings.timezone);
  const sb = await createClient();
  const { data } = await sb.from("leads").select("*").order("follow_up_on", { ascending: true, nullsFirst: false }).limit(1000);
  const all = (data ?? []) as Lead[];

  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, all.filter((l) => l.status === s).length]));
  const open = all.filter((l) => OPEN.includes(l.status));
  const due = open.filter((l) => l.follow_up_on && l.follow_up_on <= today);
  const closed = counts.converted + counts.lost;
  const conversion = closed ? Math.round((counts.converted / closed) * 100) : 0;

  const leads =
    view === "open" ? open : view === "due" ? due : view === "all" ? all : all.filter((l) => l.status === view);

  const bySource = LEAD_SOURCES.map((s) => ({ label: label(s), value: all.filter((l) => l.source === s).length })).filter((s) => s.value > 0);

  return (
    <>
      <PageHeader
        title="Leads & enquiries"
        description="Track prospects from first enquiry to paying member."
        actions={
          <FormDialog title="New lead" trigger={<><Plus size={16} /> New lead</>} action={saveLead}>
            <LeadFields today={today} />
          </FormDialog>
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Stat label="Open leads" value={open.length} hint={`${counts.new} new · ${counts.contacted} contacted · ${counts.trial} on trial`} />
          <Stat label="Follow-ups due" value={due.length} tone={due.length ? "warn" : "neutral"} href="/leads?view=due" hint="Today or overdue" />
          <Stat label="Converted" value={counts.converted} tone="good" />
          <Stat label="Conversion rate" value={`${conversion}%`} hint="Converted ÷ closed leads" />
        </div>
        <Card title="Where leads come from">
          {bySource.length ? <SimpleBarChart data={bySource} name="Leads" horizontal height={Math.max(140, bySource.length * 32)} /> : <Empty>No leads yet.</Empty>}
        </Card>
      </div>

      <Tabs
        current={view}
        items={[
          { key: "open", label: `Open (${open.length})`, href: "/leads" },
          { key: "due", label: `Due (${due.length})`, href: "/leads?view=due" },
          ...LEAD_STATUSES.map((s) => ({ key: s, label: `${label(s)} (${counts[s]})`, href: `/leads?view=${s}` })),
          { key: "all", label: "All", href: "/leads?view=all" },
        ]}
      />

      <Card bodyClass="">
        {!leads.length ? (
          <Empty>No leads in this view.</Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Source</th>
                  <th>Interest</th>
                  <th>Stage</th>
                  <th>Follow up</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <p className="font-medium text-ink">{l.full_name}</p>
                      <p className="text-xs text-muted">Added {fmtDate(localDate(l.created_at, settings.timezone))}</p>
                    </td>
                    <td className="text-xs">
                      {l.phone ?? "-"}
                      {l.email && <p className="text-muted">{l.email}</p>}
                    </td>
                    <td>{label(l.source)}</td>
                    <td className="max-w-[180px] truncate">{l.interest ?? "-"}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td>
                      {!l.follow_up_on || !OPEN.includes(l.status) ? (
                        <span className="text-muted">-</span>
                      ) : l.follow_up_on < today ? (
                        <Badge tone="bad">Overdue · {fmtDate(l.follow_up_on)}</Badge>
                      ) : l.follow_up_on === today ? (
                        <Badge tone="warn">Today</Badge>
                      ) : (
                        fmtDate(l.follow_up_on)
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {NEXT[l.status] && (
                          <ActionButton
                            action={setLeadStatus.bind(null, l.id, NEXT[l.status])}
                            className="btn-ghost btn-sm"
                            successMessage={`Moved to ${label(NEXT[l.status])}`}
                          >
                            → {label(NEXT[l.status])}
                          </ActionButton>
                        )}
                        {l.converted_member_id ? (
                          <Link href={`/members/${l.converted_member_id}`} className="btn-ghost btn-sm">View member</Link>
                        ) : (
                          l.status !== "lost" && (
                            <Link href={`/members/new?lead=${l.id}`} className="btn-ghost btn-sm text-good" title="Convert to member: opens New admission">
                              <UserCheck size={14} /> Convert
                            </Link>
                          )
                        )}
                        <FormDialog title="Edit lead" trigger={<Pencil size={14} />} triggerClass="btn-ghost btn-sm" action={saveLead}>
                          <LeadFields l={l} today={today} />
                        </FormDialog>
                        <ActionButton
                          action={deleteRecord.bind(null, "leads", l.id)}
                          confirmLabel="Delete lead"
                          confirmText={`Delete the lead ${l.full_name}? This can't be undone.`}
                          successMessage="Lead deleted"
                        >
                          <Trash2 size={14} />
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
