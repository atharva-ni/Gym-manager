import Link from "next/link";
import Form from "next/form";
import { ChevronLeft, ChevronRight, LogIn, LogOut, Ticket, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { addDays, dayBoundsUTC, fmtDate, fmtTime, INSIDE_HOURS, insideSince, todayISO } from "@/lib/format";
import type { Attendance } from "@/lib/types";
import { Badge, Card, Empty, PageHeader, Stat, TableWrap } from "@/components/ui";
import { ActionButton, ActionForm, FormDialog, SubmitButton } from "@/components/forms";
import { DayPassFields } from "@/components/day-pass-fields";
import { sellDayPass } from "../members/actions";
import { MemberSelect } from "@/components/member-select";
import { SimpleBarChart } from "@/components/charts";
import { deleteRecord } from "@/app/actions";
import { checkInForm, checkOut, checkOutAll } from "./actions";

export const metadata = { title: "Attendance · SetFit Fitness" };

export default async function AttendancePage(props: PageProps<"/attendance">) {
  const sp = await props.searchParams;
  const settings = await getSettings();
  const tz = settings.timezone;
  const today = todayISO(tz);
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const isToday = date === today;

  const sb = await createClient();
  const day = dayBoundsUTC(date, tz);
  const last30 = dayBoundsUTC(addDays(today, -29), tz, today);

  const [{ data }, { data: passRows }, { data: recent }] = await Promise.all([
    sb
      .from("attendance")
      .select("*, members(full_name, member_code)")
      .gte("check_in", day.start)
      .lt("check_in", day.end)
      .order("check_in", { ascending: false }),
    sb.from("plans").select("id, name, price, duration_days").eq("kind", "pass").eq("is_active", true).order("price"),
    sb.rpc("attendance_by_hour", { p_from: last30.start, p_to: last30.end, p_tz: tz }),
  ]);
  const visits = (data ?? []) as Attendance[];
  // Open check-ins count as inside for a few hours (people forget to check out)
  const since = insideSince(day.start);
  const isInside = (v: Attendance) => isToday && !v.check_out && v.check_in >= since;
  const inside = visits.filter(isInside);

  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of (recent ?? []) as { hour: number; visits: number }[]) hours[r.hour] = Number(r.visits);
  const visits30 = hours.reduce((a, b) => a + b, 0);
  const firstHour = hours.findIndex((h) => h > 0);
  const lastHour = 23 - [...hours].reverse().findIndex((h) => h > 0);
  const hourData =
    firstHour === -1
      ? []
      : hours.slice(firstHour, lastHour + 1).map((v, i) => {
          const h = firstHour + i;
          return { label: `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`, value: v };
        });
  const peak = hours.indexOf(Math.max(...hours));
  const durations = visits.filter((v) => v.check_out).map((v) => (Date.parse(v.check_out!) - Date.parse(v.check_in)) / 60000);
  const avgMins = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  return (
    <>
      <PageHeader title="Attendance" description="Check members in and out and see when your gym is busiest." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={isToday ? "Check-ins today" : `Check-ins ${fmtDate(date)}`} value={visits.length} />
        <Stat label="Currently inside" value={isToday ? inside.length : "-"} hint={isToday ? `Open check-ins from the last ${INSIDE_HOURS} hours` : undefined} tone="good" />
        <Stat label="Avg. session" value={avgMins ? `${Math.floor(avgMins / 60)}h ${avgMins % 60}m` : "-"} hint="Checked-out visits" />
        <Stat
          label="Peak hour (30 days)"
          value={visits30 ? `${((peak + 11) % 12) + 1}${peak < 12 ? " AM" : " PM"}` : "-"}
          hint={`${visits30} visits in 30 days`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card title="Quick check-in">
            <ActionForm action={checkInForm} resetOnSuccess>
              <MemberSelect required />
              <SubmitButton className="btn-primary w-full">
                <LogIn size={16} /> Check in
              </SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Walk-in visitor">
            <p className="mb-3 text-sm text-muted">Sell a day pass or trial to someone who isn’t a member yet.</p>
            <FormDialog
              title="Day pass / trial"
              trigger={<><Ticket size={16} /> Sell day pass / trial</>}
              triggerClass="btn-secondary w-full"
              action={sellDayPass}
              submitLabel="Save"
              successMessage="Day pass sold"
            >
              {passRows?.length ? (
                <DayPassFields passes={passRows} currency={settings.currency} />
              ) : (
                <p className="text-sm text-muted">
                  First add a pass on the <Link href="/plans" className="text-brand underline">Plans page</Link> (type “Day pass / trial”, e.g. 1 day for ₹200).
                </p>
              )}
            </FormDialog>
          </Card>
          <Card title="Busiest hours · last 30 days">
            {hourData.length ? (
              <SimpleBarChart data={hourData} name="Check-ins" height={220} />
            ) : (
              <Empty>No visits in the last 30 days.</Empty>
            )}
          </Card>
        </div>

        <Card
          className="lg:col-span-2"
          bodyClass=""
          title={
            <span className="flex items-center gap-2">
              <Link className="btn-ghost btn-sm" href={`/attendance?date=${addDays(date, -1)}`} aria-label="Previous day">
                <ChevronLeft size={16} />
              </Link>
              {isToday ? "Today" : fmtDate(date)}
              {!isToday && (
                <Link className="btn-ghost btn-sm" href={`/attendance?date=${addDays(date, 1)}`} aria-label="Next day">
                  <ChevronRight size={16} />
                </Link>
              )}
            </span>
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              {isToday && visits.some((v) => !v.check_out) && (
                <ActionButton
                  action={checkOutAll}
                  className="btn-secondary btn-sm"
                  confirmLabel="Check everyone out"
                  confirmText="Mark everyone still checked in today as checked out now? Use this at closing time."
                >
                  <LogOut size={14} /> Check out all
                </ActionButton>
              )}
            <Form action="/attendance" className="flex items-center gap-2">
              <input type="date" name="date" defaultValue={date} max={today} className="input w-auto py-1" />
              <button className="btn-secondary btn-sm">Go</button>
            </Form>
            </div>
          }
        >
          {!visits.length ? (
            <Empty>No check-ins on this day.</Empty>
          ) : (
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <Link href={`/members/${v.member_id}`} className="font-medium text-ink hover:text-brand">
                          {v.members?.full_name ?? "Unknown"}
                        </Link>
                        <span className="ml-2 text-xs text-muted">{v.members?.member_code}</span>
                      </td>
                      <td>{fmtTime(v.check_in, tz)}</td>
                      <td>{v.check_out ? fmtTime(v.check_out, tz) : "-"}</td>
                      <td>
                        {v.check_out ? (
                          <Badge>Left</Badge>
                        ) : isInside(v) ? (
                          <Badge tone="good">Inside</Badge>
                        ) : (
                          <span title={`No check-out; counted as left after ${INSIDE_HOURS} hours`}>
                            <Badge>Left (no check-out)</Badge>
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {!v.check_out && (
                            <ActionButton action={checkOut.bind(null, v.id)} className="btn-secondary btn-sm">
                              <LogOut size={14} /> Check out
                            </ActionButton>
                          )}
                          <ActionButton action={deleteRecord.bind(null, "attendance", v.id)} confirmLabel="Remove check-in" confirmText={`Remove ${v.members?.full_name ?? "this member"}'s check-in at ${fmtTime(v.check_in, tz)}?`} successMessage="Check-in removed">
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
      </div>
    </>
  );
}
