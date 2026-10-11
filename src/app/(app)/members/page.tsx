import Link from "next/link";
import Form from "next/form";
import { Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { addDays, fmtDate, localDate, money, todayISO } from "@/lib/format";
import { daysLeftText, membershipState } from "@/lib/member-state";
import type { MemberOverview } from "@/lib/types";
import { Avatar, Badge, Card, Empty, PageHeader, StatusBadge, TableWrap, Tabs } from "@/components/ui";

export const metadata = { title: "Members · SetFit Fitness" };

const PAGE_SIZE = 25;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "expiring", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
  { key: "dues", label: "With dues" },
  { key: "frozen", label: "Frozen" },
  { key: "passes", label: "Day pass visitors" },
  { key: "inactive", label: "Inactive" },
];

export default async function MembersPage(props: PageProps<"/members">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const filter = typeof sp.filter === "string" ? sp.filter : "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const settings = await getSettings();
  const today = todayISO(settings.timezone);
  const soon = addDays(today, settings.expiry_alert_days);
  const sb = await createClient();

  let query = sb.from("member_overview").select("*", { count: "exact" });
  if (q) {
    const safe = q.replace(/[%,()*]/g, " ");
    const digits = q.replace(/\D/g, "").slice(-10);
    const filters = [`full_name.ilike.%${safe}%`, `member_code.ilike.%${safe}%`, `email.ilike.%${safe}%`];
    if (digits.length >= 3) filters.push(`phone_digits.like.%${digits}%`);
    query = query.or(filters.join(","));
  }
  switch (filter) {
    case "active":
      // Same rule as the dashboard: active account, active gym membership (not a day pass), not ended
      query = query.eq("status", "active").eq("membership_status", "active").eq("membership_kind", "membership").gte("membership_end", today);
      break;
    case "expiring":
      query = query.neq("status", "inactive").eq("membership_kind", "membership").gte("membership_end", today).lte("membership_end", soon);
      break;
    case "expired":
      query = query.neq("status", "inactive").eq("membership_kind", "membership").lt("membership_end", today);
      break;
    case "passes":
      query = query.eq("membership_kind", "pass");
      break;
    case "dues":
      query = query.gt("balance_due", 0);
      break;
    case "frozen":
      query = query.or(`status.eq.frozen,and(freeze_start.lte.${today},freeze_end.gte.${today})`);
      break;
    case "inactive":
      query = query.eq("status", "inactive");
      break;
  }
  const { data, count } = await query
    .order(filter === "expiring" || filter === "expired" ? "membership_end" : "created_at", {
      ascending: filter === "expiring",
    })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const members = (data ?? []) as MemberOverview[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: Record<string, string | number>) =>
    "?" + new URLSearchParams({ ...(q ? { q } : {}), filter, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) });

  return (
    <>
      <PageHeader
        title="Members"
        description={`${total} member${total === 1 ? "" : "s"}${filter !== "all" ? ` · ${FILTERS.find((f) => f.key === filter)?.label}` : ""}`}
        actions={
          <Link href="/members/new" className="btn-primary">
            <Plus size={16} /> New admission
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          current={filter}
          items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: `/members?${new URLSearchParams({ ...(q ? { q } : {}), filter: f.key })}` }))}
        />
        <Form action="/members" className="relative w-full sm:w-72">
          <input type="hidden" name="filter" value={filter} />
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search name, code, phone…" className="input pl-9" />
        </Form>
      </div>

      <Card bodyClass="">
        {!members.length ? (
          <Empty>
            {q || filter !== "all" ? (
              "No members match this view."
            ) : (
              <>
                No members yet. <Link href="/members/new" className="text-brand underline">Add your first admission</Link>.
              </>
            )}
          </Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Phone</th>
                  <th>Plan</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th className="num">Dues</th>
                  <th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const state = membershipState(m, today, settings.expiry_alert_days);
                  return (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/members/${m.id}`} className="flex items-center gap-3">
                          <Avatar name={m.full_name} />
                          <span>
                            <span className="block font-medium text-ink hover:text-brand">{m.full_name}</span>
                            <span className="text-xs text-muted">{m.member_code}</span>
                          </span>
                        </Link>
                      </td>
                      <td>{m.phone ?? "-"}</td>
                      <td>
                        {m.plan_name ?? <span className="text-muted">No plan</span>}
                        {m.membership_kind === "pass" && (
                          <span className="ml-2 inline-flex">
                            <Badge>Pass</Badge>
                          </span>
                        )}
                        {m.pt_plan_name && (
                          <span className="ml-2 inline-flex">
                            <Badge tone="brand">PT</Badge>
                          </span>
                        )}
                      </td>
                      <td>
                        {fmtDate(m.membership_end)}
                        {m.membership_end && <span className="block text-xs text-muted">{daysLeftText(m.membership_end, today)}</span>}
                      </td>
                      <td>
                        <StatusBadge status={state} />
                      </td>
                      <td className={`num ${Number(m.balance_due) > 0 ? "font-medium text-bad" : ""}`}>
                        {Number(m.balance_due) > 0 ? money(m.balance_due, settings.currency) : "-"}
                      </td>
                      <td className="text-xs">{m.last_visit ? fmtDate(localDate(m.last_visit, settings.timezone)) : "Never"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link className="btn-secondary btn-sm" href={`/members${qs({ page: page - 1 })}`}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link className="btn-secondary btn-sm" href={`/members${qs({ page: page + 1 })}`}>
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
