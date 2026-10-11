import Link from "next/link";
import {
  AlertTriangle, CalendarClock, ClipboardCheck, CreditCard, MessageCircle, Package, TrendingUp, UserPlus, Users, Wallet, Wrench,
} from "lucide-react";
import { waLink } from "@/lib/whatsapp";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { addDays, addMonths, dayBoundsUTC, fmtClock, fmtDate, money, monthLabel, todayISO } from "@/lib/format";
import { daysLeftText } from "@/lib/member-state";
import { label } from "@/lib/constants";
import type { GymClass, MemberOverview, Payment } from "@/lib/types";
import { Avatar, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { RevenueExpenseChart } from "@/components/charts";

type DashStats = {
  total_members: number;
  active_members: number;
  expiring: number;
  renewals_due: number;
  expired: number;
  new_members: number;
  checkins_today: number;
  inside_now: number;
  revenue_month: number;
  revenue_today: number;
  expenses_month: number;
  dues_total: number;
  dues_members: number;
  dues_overdue: number;
  pt_clients: number;
  frozen_now: number;
  passes_today: number;
  refunds_month: number;
  open_leads: number;
  followups_due: number;
  low_stock: number;
  equipment_alerts: number;
};

export default async function DashboardPage() {
  const settings = await getSettings();
  const { currency, timezone } = settings;
  const today = todayISO(timezone);
  const soon = addDays(today, settings.expiry_alert_days);
  const day = dayBoundsUTC(today, timezone);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sb = await createClient();

  const [statsRes, financeRes, expiringRes, paymentsRes, classesRes, birthdaysRes] = await Promise.all([
    sb.rpc("dashboard_stats", {
      p_today: today,
      p_alert_days: settings.expiry_alert_days,
      p_day_start: day.start,
      p_day_end: day.end,
    }),
    sb.rpc("finance_monthly", { p_from: addMonths(today, -5), p_to: today }),
    sb
      .from("member_overview")
      .select("id, full_name, member_code, phone, plan_name, membership_end, balance_due")
      .neq("status", "inactive")
      .eq("membership_kind", "membership")
      .gte("membership_end", today)
      .lte("membership_end", soon)
      .order("membership_end")
      .limit(8),
    sb.from("payments").select("*, members(full_name, member_code)").order("created_at", { ascending: false }).limit(6),
    sb.from("classes").select("*, trainers(full_name)").eq("day_of_week", dow).eq("is_active", true).order("start_time"),
    sb.rpc("birthdays_on", { p_day: today }).select("id, full_name, phone"),
  ]);

  const s = (statsRes.data ?? {}) as Partial<DashStats>;
  const n = (k: keyof DashStats) => Number(s[k] ?? 0);
  const net = n("revenue_month") - n("expenses_month");
  const finance = ((financeRes.data ?? []) as { month: string; payments: number; sales: number; expenses: number }[]).map((r) => ({
    month: monthLabel(r.month),
    revenue: Number(r.payments) + Number(r.sales),
    expenses: Number(r.expenses),
  }));
  const expiring = (expiringRes.data ?? []) as MemberOverview[];
  const payments = (paymentsRes.data ?? []) as Payment[];
  const classes = (classesRes.data ?? []) as GymClass[];
  const birthdays = (birthdaysRes.data ?? []) as { id: string; full_name: string; phone: string | null }[];

  const alerts = [
    { label: "Renewals due (gym + PT)", value: n("renewals_due"), href: "/payments?tab=expiring", icon: CalendarClock, tone: "warn" as const },
    { label: "Expired", value: n("expired"), href: "/members?filter=expired", icon: AlertTriangle, tone: "bad" as const },
    { label: `Pending dues${n("dues_overdue") ? ` · ${n("dues_overdue")} overdue` : ""}`, value: money(n("dues_total"), currency), raw: n("dues_total"), href: "/payments?tab=dues", icon: Wallet, tone: "warn" as const },
    { label: "Lead follow-ups", value: n("followups_due"), href: "/leads?view=due", icon: UserPlus, tone: "brand" as const },
    { label: "Low stock items", value: n("low_stock"), href: "/inventory", icon: Package, tone: "warn" as const },
    { label: "Equipment alerts", value: n("equipment_alerts"), href: "/equipment", icon: Wrench, tone: "bad" as const },
  ];

  return (
    <>
      <PageHeader
        title={settings.gym_name}
        description={new Date(`${today}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
        actions={
          <>
            <Link href="/attendance" className="btn-secondary"><ClipboardCheck size={16} /> Check in</Link>
            <Link href="/payments?tab=dues" className="btn-secondary"><CreditCard size={16} /> Collect fees</Link>
            <Link href="/members/new" className="btn-primary"><UserPlus size={16} /> New admission</Link>
          </>
        }
      />

      {statsRes.error && (
        <p className="mb-6 rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">
          Could not load dashboard data: {statsRes.error.message}. Did you run <code>supabase/schema.sql</code> in your Supabase project?
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active members" value={n("active_members")} hint={`${n("total_members")} total · +${n("new_members")} this month · ${n("pt_clients")} on PT${n("frozen_now") ? ` · ${n("frozen_now")} frozen` : ""}`} icon={<Users size={16} />} tone="brand" href="/members?filter=active" />
        <Stat label="Check-ins today" value={n("checkins_today")} hint={`${n("inside_now")} in the gym now${n("passes_today") ? ` · ${n("passes_today")} day pass` : ""}`} icon={<ClipboardCheck size={16} />} tone="good" href="/attendance" />
        <Stat label="Revenue this month" value={money(n("revenue_month"), currency)} hint={`${money(n("revenue_today"), currency)} today`} icon={<TrendingUp size={16} />} tone="brand" href="/reports" />
        <Stat
          label="Net profit this month"
          value={money(net, currency)}
          hint={`Expenses ${money(n("expenses_month"), currency)}${n("refunds_month") ? ` · refunds ${money(n("refunds_month"), currency)}` : ""}`}
          icon={<Wallet size={16} />}
          tone={net >= 0 ? "good" : "bad"}
          href="/reports"
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {alerts.map((a) => {
          const active = (a.raw ?? Number(a.value)) > 0;
          const Icon = a.icon;
          return (
            <Link key={a.label} href={a.href} className={`card flex items-center gap-3 p-3 transition hover:border-brand/40 ${active ? "" : "opacity-60"}`}>
              <span className={`rounded-lg p-2 ${active ? { warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", brand: "bg-brand-soft text-brand" }[a.tone] : "bg-surface-2 text-muted"}`}>
                <Icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold tabular-nums leading-tight">{a.value}</span>
                <span className="block truncate text-xs text-muted">{a.label}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card title="Revenue vs expenses · last 6 months" className="xl:col-span-2" action={<Link href="/reports" className="text-xs text-brand">Full report →</Link>}>
          <RevenueExpenseChart data={finance} currency={currency} />
        </Card>
        <Card title="Today’s classes" bodyClass="" action={<Link href="/classes" className="text-xs text-brand">Schedule →</Link>}>
          {!classes.length ? (
            <Empty>No classes scheduled today.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {classes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="text-xs text-muted">{c.trainers?.full_name ?? "No trainer"}{c.room ? ` · ${c.room}` : ""}</p>
                  </div>
                  <span className="text-xs font-medium text-brand whitespace-nowrap">{fmtClock(c.start_time)}</span>
                </li>
              ))}
            </ul>
          )}
          {birthdays.length > 0 && (
            <div className="border-t border-line px-5 py-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Birthdays today</p>
              <ul className="mt-1 space-y-1">
                {birthdays.map((b) => {
                  const wish = waLink(b.phone, `Happy birthday, ${b.full_name}! Wishing you a great year ahead from all of us at ${settings.gym_name}.`);
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-2">
                      <Link href={`/members/${b.id}`} className="text-ink hover:text-brand">{b.full_name}</Link>
                      {wish && (
                        <a href={wish} target="_blank" rel="noreferrer" className="btn-ghost btn-sm text-good" title="Send birthday wish on WhatsApp">
                          <MessageCircle size={14} /> Wish
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Expiring in the next ${settings.expiry_alert_days} days`} bodyClass="" action={<Link href="/payments?tab=expiring" className="text-xs text-brand">Renewals →</Link>}>
          {!expiring.length ? (
            <Empty>No memberships expiring soon.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {expiring.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <Link href={`/members/${m.id}`} className="flex min-w-0 items-center gap-3">
                    <Avatar name={m.full_name} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{m.full_name}</span>
                      <span className="block truncate text-xs text-muted">{m.plan_name} · {m.phone ?? m.member_code}</span>
                    </span>
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="text-right text-xs">
                      <span className="block font-medium text-warn">{daysLeftText(m.membership_end, today)}</span>
                      <span className="text-muted">{fmtDate(m.membership_end)}</span>
                    </span>
                    {(() => {
                      const wa = waLink(
                        m.phone,
                        `Hi ${m.full_name}, your ${m.plan_name} membership at ${settings.gym_name} ends on ${fmtDate(m.membership_end)}. Renew now to keep training without a break. See you at the gym!`,
                      );
                      return wa ? (
                        <a href={wa} target="_blank" rel="noreferrer" className="btn-ghost btn-sm text-good" title="Send renewal reminder on WhatsApp">
                          <MessageCircle size={14} />
                        </a>
                      ) : null;
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent payments" bodyClass="" action={<Link href="/payments" className="text-xs text-brand">All payments →</Link>}>
          {!payments.length ? (
            <Empty>No payments yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/members/${p.member_id}`} className="block truncate font-medium text-ink hover:text-brand">{p.members?.full_name ?? "Member"}</Link>
                    <p className="text-xs text-muted">{fmtDate(p.paid_on)} · {label(p.category)} · {label(p.method)}</p>
                  </div>
                  <span className="font-semibold tabular-nums text-good">+{money(p.amount, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
