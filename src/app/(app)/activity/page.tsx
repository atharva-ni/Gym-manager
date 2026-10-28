import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings, requireOwner } from "@/lib/auth";
import { dayBoundsUTC, fmtDate, fmtDateTime, money, todayISO } from "@/lib/format";
import { label } from "@/lib/constants";
import { rangeParams } from "@/lib/queries";
import { Badge, Card, Empty, PageHeader, TableWrap } from "@/components/ui";
import { DateRangeFilter } from "@/components/date-range";

export const metadata = { title: "Activity log · SetFit Fitness" };

type Row = Record<string, unknown>;
type Entry = {
  id: string;
  at: string;
  actor_email: string | null;
  actor_role: "owner" | "staff" | "system";
  table_name: string;
  record_id: string | null;
  action: "insert" | "update" | "delete" | "void";
  reason: string | null;
  before: Row | null;
  after: Row | null;
};

const TYPES = [
  { value: "payments", label: "Payments" },
  { value: "refunds", label: "Refunds" },
  { value: "sales", label: "Counter sales" },
  { value: "memberships", label: "Plans & fees" },
  { value: "members", label: "Members" },
  { value: "expenses", label: "Expenses" },
  { value: "staff_accounts", label: "Staff logins" },
];

// Fields worth showing when something is edited, with how to print them
const FIELDS: Record<string, "money" | "date" | "text"> = {
  amount: "money", price: "money", discount: "money", total: "money", method: "text", category: "text",
  paid_on: "date", start_date: "date", end_date: "date", balance_due_on: "date", status: "text",
  full_name: "text", phone: "text", plan_name: "text", sessions_total: "text", active: "text", member_id: "text",
  photo_path: "text", trainer_id: "text", spent_on: "date", vendor: "text", quantity: "text",
};

export default async function ActivityPage(props: PageProps<"/activity">) {
  await requireOwner();
  const sp = await props.searchParams;
  const settings = await getSettings();
  const { currency, timezone } = settings;
  const today = todayISO(timezone);
  const { from, to } = rangeParams(sp, today);
  const type = typeof sp.type === "string" && TYPES.some((t) => t.value === sp.type) ? sp.type : "";
  const who = typeof sp.who === "string" ? sp.who : "";

  const sb = await createClient();
  const range = dayBoundsUTC(from, timezone, to);
  let query = sb
    .from("activity_log")
    .select("*")
    .gte("at", range.start)
    .lt("at", range.end)
    .order("at", { ascending: false })
    .limit(300);
  if (type) query = query.eq("table_name", type);
  if (who === "staff" || who === "owner" || who === "system") query = query.eq("actor_role", who);
  else if (who) query = query.eq("actor_email", who);
  const [{ data, error }, { data: staffRows }] = await Promise.all([
    query,
    sb.from("staff_accounts").select("email, full_name").order("full_name"),
  ]);
  const entries = (data ?? []) as Entry[];
  const staffName = new Map((staffRows ?? []).map((s) => [s.email.toLowerCase(), s.full_name as string]));

  // Member names for the readable lines
  const memberIds = new Set<string>();
  for (const e of entries) {
    const row = { ...e.before, ...e.after };
    if (typeof row.member_id === "string") memberIds.add(row.member_id);
    if (e.table_name === "members" && e.record_id) memberIds.add(e.record_id);
  }
  const { data: memberRows } = memberIds.size
    ? await sb.from("members").select("id, full_name, member_code").in("id", [...memberIds])
    : { data: [] };
  const members = new Map((memberRows ?? []).map((m) => [m.id as string, `${m.full_name} (${m.member_code})`]));

  const ctx = { currency, members };
  const voids = entries.filter((e) => e.action === "void").length;
  const staffActions = entries.filter((e) => e.actor_role === "staff").length;

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Every payment, refund, sale, plan change, member edit and void, with who did it and when. Entries can't be edited or removed."
      />

      <DateRangeFilter action="/activity" from={from} to={to}>
        <label>
          <span className="label">Type</span>
          <select name="type" defaultValue={type} className="input w-auto">
            <option value="">Everything</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Done by</span>
          <select name="who" defaultValue={who} className="input w-auto">
            <option value="">Anyone</option>
            <option value="owner">Owner</option>
            <option value="staff">All staff</option>
            {(staffRows ?? []).map((s) => (
              <option key={s.email} value={s.email}>
                {s.full_name}
              </option>
            ))}
            <option value="system">System / SQL editor</option>
          </select>
        </label>
      </DateRangeFilter>

      {(voids > 0 || staffActions > 0) && (
        <p className="mb-4 text-sm text-ink-2">
          {entries.length} entries{voids > 0 && <> · <span className="font-medium text-bad">{voids} voided</span></>}
          {staffActions > 0 && <> · {staffActions} by staff</>}
        </p>
      )}

      <Card bodyClass="">
        {error ? (
          <Empty>
            The activity log needs the latest database update. Run <code>supabase/migrations/009_staff_and_activity.sql</code> in the Supabase SQL
            Editor.
          </Empty>
        ) : !entries.length ? (
          <Empty>Nothing recorded in this period.</Empty>
        ) : (
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>What happened</th>
                  <th>When</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const changes = e.action === "update" ? changeList(e, ctx) : [];
                  const memberId = e.table_name === "members" ? e.record_id : (({ ...e.before, ...e.after }).member_id as string | undefined);
                  return (
                    <tr key={e.id}>
                      <td>
                        <div>
                          <p className="text-ink">
                            {e.action === "void" && <Badge tone="bad">Voided</Badge>} {e.action === "delete" && <Badge tone="warn">Deleted</Badge>}{" "}
                            {describe(e, ctx)}
                          </p>
                          {e.reason && <p className="mt-0.5 text-xs text-bad">Reason: {e.reason}</p>}
                          {changes.length > 0 && <p className="mt-0.5 text-xs text-muted">{changes.join(" · ")}</p>}
                          {memberId && members.has(memberId) && e.action !== "delete" && (
                            <Link href={`/members/${memberId}`} className="text-xs text-brand hover:underline">
                              Open member
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{fmtDateTime(e.at, timezone)}</td>
                      <td>
                        <div>
                          <p className="text-ink">
                            {e.actor_role === "system"
                              ? "System"
                              : e.actor_role === "owner"
                                ? "Owner"
                                : (staffName.get(e.actor_email?.toLowerCase() ?? "") ?? e.actor_email ?? "Staff")}
                          </p>
                          {e.actor_role === "staff" && <p className="text-xs text-muted">Staff · {e.actor_email}</p>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {entries.length === 300 && <p className="mt-3 text-xs text-muted">Showing the latest 300. Narrow the dates or type to see more.</p>}
    </>
  );
}

type Ctx = { currency: string; members: Map<string, string> };

/** One readable line per entry, e.g. "Collected ₹1,500 by UPI from Asha Rao (M-0012) · R-00041". */
function describe(e: Entry, { currency, members }: Ctx): string {
  const r = { ...e.before, ...(e.action === "update" ? {} : e.after) } as Row;
  const who = members.get(String(r.member_id ?? (e.table_name === "members" ? e.record_id : ""))) ?? (r.full_name as string) ?? "a member";
  const amt = (v: unknown) => money(Number(v ?? 0), currency);
  const verb = { insert: "Added", update: "Edited", delete: "Deleted", void: "Voided" }[e.action];
  switch (e.table_name) {
    case "payments":
      if (e.action === "insert") return `Collected ${amt(r.amount)} by ${label(String(r.method))} from ${who}${r.receipt_no ? ` · ${r.receipt_no}` : ""}`;
      return `${verb} payment ${r.receipt_no ?? ""} of ${amt(r.amount)} from ${who}`.replace("  ", " ");
    case "refunds":
      if (e.action === "insert") return `Refunded ${amt(r.amount)} to ${who}${r.refund_no ? ` · ${r.refund_no}` : ""}`;
      return `${verb} refund ${r.refund_no ?? ""} of ${amt(r.amount)} to ${who}`.replace("  ", " ");
    case "sales": {
      const what = `${r.quantity} × ${r.product_name} for ${amt(r.total)}`;
      if (e.action === "insert") return `Sold ${what}${r.member_id ? ` to ${who}` : ""}${r.receipt_no ? ` · ${r.receipt_no}` : ""}`;
      return `${verb} sale ${r.receipt_no ?? ""}: ${what}`.replace("  ", " ");
    }
    case "memberships": {
      const plan = `${r.plan_name ?? "plan"}${r.kind === "charge" ? "" : ` (${fmtDate(String(r.start_date))} to ${fmtDate(String(r.end_date))})`}`;
      if (e.action === "insert") return `New ${plan} for ${who}, fee ${amt(Number(r.price ?? 0) - Number(r.discount ?? 0))}`;
      return `${verb} ${plan} of ${who}`;
    }
    case "members":
      if (e.action === "insert") return `New member ${r.full_name} (${r.member_code})`;
      return `${verb} member ${r.full_name ?? who}`;
    case "expenses":
      return `${verb} expense: ${amt(r.amount)} ${label(String(r.category))}${r.description ? `, ${r.description}` : ""}`;
    case "staff_accounts":
      if (e.action === "update" && e.after && "active" in e.after) {
        return `${e.after.active ? "Switched on" : "Switched off"} staff login of ${r.full_name}`;
      }
      return `${verb} staff login ${r.full_name} (${r.email})`;
    default:
      return `${verb} ${e.table_name}`;
  }
}

/** "price ₹1,500 → ₹1,200" for the edited fields that matter. */
function changeList(e: Entry, { currency, members }: Ctx): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(e.after ?? {})) {
    const kind = FIELDS[k];
    if (!kind) continue;
    const show = (x: unknown) => {
      if (x === null || x === undefined || x === "") return "none";
      if (k === "member_id") return members.get(String(x)) ?? "another member";
      if (k === "photo_path" || k === "trainer_id") return "set";
      if (kind === "money") return money(Number(x), currency);
      if (kind === "date") return fmtDate(String(x));
      if (typeof x === "boolean") return x ? "yes" : "no";
      return label(String(x));
    };
    const name = k === "photo_path" ? "photo" : k === "member_id" ? "member" : k.replace(/_/g, " ");
    out.push(`${name} ${show(e.before?.[k])} → ${show(v)}`);
  }
  return out;
}
