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
  const LIMIT = 500;
  const countOf = (status?: string, extra?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    let q = base();
    if (status) q = q.eq("status", status);
    return (extra ? extra(q) : q).then((r) => r.count ?? 0);
  };
  function base() {
    return sb.from("leads").select("id", { count: "exact", head: true });
  }
  let listQuery = sb.from("leads").select("*").order("follow_up_on", { ascending: true, nullsFirst: false }).limit(LIMIT);
  if (view === "open") listQuery = listQuery.in("status", OPEN);
  else if (view === "due") listQuery = listQuery.in("status", OPEN).lte("follow_up_on", today);
  else if (view !== "all") listQuery = listQuery.eq("status", view);

  const [{ data }, statusCounts, dueCount, { data: sources }] = await Promise.all([
    listQuery,
    Promise.all(LEAD_STATUSES.map((st) => countOf(st))),
    countOf(undefined, (q) => q.in("status", OPEN).lte("follow_up_on", today)),
    sb.from("leads").select("source").limit(5000),
  ]);
  const leads = (data ?? []) as Lead[];
  const counts = Object.fromEntries(LEAD_STATUSES.map((st, i) => [st, statusCounts[i]])) as Record<string, number>;
  const openCount = counts.new + counts.contacted + counts.trial;
  const totalCount = statusCounts.reduce((a, b) => a + b, 0);
  const viewCount = view === "open" ? openCount : view === "due" ? dueCount : view === "all" ? totalCount : (counts[view] ?? 0);
  const closed = counts.converted + counts.lost;
  const conversion = closed ? Math.round((counts.converted / closed) * 100) : 0;
  const sourceRows = (sources ?? []) as { source: string }[];
  const bySource = LEAD_SOURCES.map((src) => ({ label: label(src), value: sourceRows.filter((l) => l.source === src).length })).filter((x) => x.value > 0);

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
          <Stat label="Open leads" value={openCount} hint={`${counts.new} new · ${counts.contacted} contacted · ${counts.trial} on trial`} />
          <Stat label="Follow-ups due" value={dueCount} tone={dueCount ? "warn" : "neutral"} href="/leads?view=due" hint="Today or overdue" />
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
          { key: "open", label: `Open (${openCount})`, href: "/leads" },
          { key: "due", label: `Due (${dueCount})`, href: "/leads?view=due" },
          ...LEAD_STATUSES.map((s) => ({ key: s, label: `${label(s)} (${counts[s]})`, href: `/leads?view=${s}` })),
          { key: "all", label: "All", href: "/leads?view=all" },
        ]}
      />

      {viewCount > leads.length && (
        <p className="mb-3 text-sm text-warn">Showing {leads.length} of {viewCount} leads in this view (earliest follow-ups first).</p>
      )}
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
