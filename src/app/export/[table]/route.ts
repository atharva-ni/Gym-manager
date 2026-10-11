import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const EXPORTABLE: Record<string, string> = {
  members: "member_code, full_name, phone, email, gender, date_of_birth, joined_on, status, address, emergency_name, emergency_phone, medical_notes, notes",
  memberships: "plan_name, kind, start_date, end_date, price, discount, paid, refunded, balance, balance_due_on, status, sessions_total, sessions_used, trainers(full_name), notes, members(member_code, full_name)",
  refunds: "refund_no, refunded_on, amount, method, reason, members(member_code, full_name)",
  freezes: "start_date, end_date, days, reason, members(member_code, full_name)",
  pt_sessions: "session_date, notes, trainers(full_name), members(member_code, full_name)",
  payments: "paid_on, amount, method, category, reference, notes, members(member_code, full_name)",
  expenses: "spent_on, category, amount, method, vendor, description",
  attendance: "check_in, check_out, members(member_code, full_name)",
  sales: "sold_on, product_name, quantity, unit_price, total, method, members(member_code, full_name)",
  leads: "created_at, full_name, phone, email, source, interest, status, follow_up_on, notes",
};

const SOURCE: Record<string, string> = { memberships: "membership_balances", freezes: "membership_freezes" };
const PAGE = 1000;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function flatten(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) out[`${k}_${k2}`.replace(/^members_/, "member_")] = v2;
    } else out[k] = v;
  }
  return out;
}

export async function GET(_req: Request, ctx: RouteContext<"/export/[table]">) {
  const { table } = await ctx.params;
  if (!(await getOwner())) return new NextResponse("Unauthorized", { status: 401 });
  const columns = EXPORTABLE[table];
  if (!columns) return new NextResponse("Not found", { status: 404 });

  const sb = await createClient();
  const rows: Record<string, unknown>[] = [];
  // Page through everything, since PostgREST caps each response.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(SOURCE[table] ?? table)
      .select(columns)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return new NextResponse(error.message, { status: 500 });
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]).map(flatten));
    if (!data || data.length < PAGE) break;
  }

  const headers = rows.length ? Object.keys(rows[0]) : columns.split(",").map((c) => c.trim());
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}-${date}.csv"`,
    },
  });
}
