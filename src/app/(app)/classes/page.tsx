import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings, requireOwner } from "@/lib/auth";
import { addDays, fmtClock, fmtDate, todayISO } from "@/lib/format";
import { DAYS } from "@/lib/constants";
import type { ClassBooking, GymClass } from "@/lib/types";
import { Badge, Card, PageHeader } from "@/components/ui";
import { MemberSelect } from "@/components/member-select";
import { ActionButton, FormDialog } from "@/components/forms";
import { Checkbox, Field, Grid, Hidden, SelectField } from "@/components/fields";
import { deleteRecord } from "@/app/actions";
import { saveClass } from "./actions";
import { bookClass, setBookingStatus } from "./booking-actions";

export const metadata = { title: "Classes · SetFit Fitness" };

const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first

function ClassFields({ c, trainers, day }: { c?: GymClass; trainers: { id: string; full_name: string }[]; day?: number }) {
  return (
    <>
      <Hidden name="id" value={c?.id} />
      <Field label="Class name" name="name" defaultValue={c?.name} placeholder="HIIT, Yoga, Spin…" required />
      <Grid>
        <SelectField
          label="Day"
          name="day_of_week"
          defaultValue={String(c?.day_of_week ?? day ?? 1)}
          options={WEEK.map((d) => ({ value: String(d), label: DAYS[d] }))}
        />
        <SelectField
          label="Trainer"
          name="trainer_id"
          placeholder="Unassigned"
          defaultValue={c?.trainer_id}
          options={trainers.map((t) => ({ value: t.id, label: t.full_name }))}
        />
        <Field label="Start" name="start_time" type="time" defaultValue={c?.start_time?.slice(0, 5) ?? "07:00"} required />
        <Field label="End" name="end_time" type="time" defaultValue={c?.end_time?.slice(0, 5) ?? "08:00"} required />
        <Field label="Capacity" name="capacity" type="number" min={1} defaultValue={c?.capacity ?? 20} required />
        <Field label="Room / area" name="room" defaultValue={c?.room ?? ""} />
      </Grid>
      <Checkbox label="Class is running" name="is_active" defaultChecked={c?.is_active ?? true} />
    </>
  );
}

export default async function ClassesPage(props: PageProps<"/classes">) {
  const { week } = await props.searchParams;
  await requireOwner(); // staff are sent to check-in
  const settings = await getSettings();
  const today = todayISO(settings.timezone);
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  // Week shown (Monday to Sunday) for bookings
  const anchor = typeof week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today;
  const anchorDow = new Date(`${anchor}T12:00:00Z`).getUTCDay();
  const monday = addDays(anchor, -((anchorDow + 6) % 7));
  const dateOf = (dow: number) => addDays(monday, (dow + 6) % 7);
  const sb = await createClient();
  const [{ data }, { data: trainers }, { data: bookingRows }] = await Promise.all([
    sb.from("classes").select("*, trainers(full_name)").order("start_time"),
    sb.from("trainers").select("id, full_name").eq("status", "active").order("full_name"),
    sb
      .from("class_bookings")
      .select("*, members(full_name, member_code)")
      .gte("class_date", monday)
      .lte("class_date", addDays(monday, 6))
      .order("created_at"),
  ]);
  const classes = (data ?? []) as GymClass[];
  const bookings = (bookingRows ?? []) as ClassBooking[];
  const bookingsOf = (classId: string, date: string) => bookings.filter((b) => b.class_id === classId && b.class_date === date);
  const weeklySpots = classes.filter((c) => c.is_active).reduce((s, c) => s + c.capacity, 0);

  return (
    <>
      <PageHeader
        title="Class schedule"
        description={`${classes.filter((c) => c.is_active).length} weekly classes · ${weeklySpots} spots per week · ${bookings.filter((b) => b.status !== "cancelled").length} booked this week`}
        actions={
          <FormDialog title="New class" trigger={<><Plus size={16} /> New class</>} action={saveClass}>
            <ClassFields trainers={trainers ?? []} />
          </FormDialog>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/classes?week=${addDays(monday, -7)}`} className="btn-secondary btn-sm" aria-label="Previous week">
          <ChevronLeft size={14} />
        </Link>
        <span className="font-medium text-ink">
          Week of {fmtDate(monday)} to {fmtDate(addDays(monday, 6))}
        </span>
        <Link href={`/classes?week=${addDays(monday, 7)}`} className="btn-secondary btn-sm" aria-label="Next week">
          <ChevronRight size={14} />
        </Link>
        {anchor !== today && (
          <Link href="/classes" className="btn-ghost btn-sm">
            This week
          </Link>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        {WEEK.map((d) => {
          const list = classes.filter((c) => c.day_of_week === d);
          return (
            <Card
              key={d}
              className={d === todayDow ? "border-brand/60" : ""}
              bodyClass="space-y-2 p-3"
              title={
                <span className="flex items-center gap-2">
                  {DAYS[d]}
                  <span className="text-xs font-normal text-muted">{fmtDate(dateOf(d)).replace(/ \d{4}$/, "")}</span>
                  {dateOf(d) === today && <span className="rounded bg-brand-soft px-1.5 text-[10px] font-semibold uppercase text-brand">Today</span>}
                </span>
              }
            >
              {list.map((c) => (
                <div key={c.id} className={`rounded-lg border border-line bg-surface-2 p-2.5 text-sm ${c.is_active ? "" : "opacity-50"}`}>
                  <p className="text-xs font-medium text-brand">
                    {fmtClock(c.start_time)} - {fmtClock(c.end_time)}
                  </p>
                  <p className="font-medium text-ink">{c.name}</p>
                  <p className="text-xs text-muted">{c.trainers?.full_name ?? "No trainer"}{c.room ? ` · ${c.room}` : ""}</p>
                  <div className="mt-1 flex items-center justify-between">
                    {(() => {
                      const date = dateOf(d);
                      const list = bookingsOf(c.id, date);
                      const active = list.filter((b) => b.status !== "cancelled");
                      const full = active.length >= c.capacity;
                      return (
                        <FormDialog
                          title={`${c.name} · ${DAYS[d]} ${fmtDate(date)}`}
                          trigger={<><Users size={12} /> {active.length}/{c.capacity}</>}
                          triggerClass={`btn-ghost btn-sm px-1.5 ${full ? "text-bad" : "text-muted"}`}
                          action={bookClass.bind(null, c.id, date)}
                          submitLabel="Book"
                        >
                          {list.length > 0 ? (
                            <ul className="divide-y divide-line text-sm">
                              {list.map((b) => (
                                <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                                  <span className={b.status === "cancelled" ? "text-muted line-through" : "text-ink"}>
                                    {b.members?.full_name ?? "Member"} <span className="text-xs text-muted">{b.members?.member_code}</span>
                                  </span>
                                  <span className="flex items-center gap-1">
                                    {b.status === "attended" && <Badge tone="good">Attended</Badge>}
                                    {b.status === "booked" && (
                                      <>
                                        <ActionButton action={setBookingStatus.bind(null, b.id, "attended")} className="btn-ghost btn-sm px-1.5 text-good" title="Mark attended">
                                          <Check size={14} />
                                        </ActionButton>
                                        <ActionButton action={setBookingStatus.bind(null, b.id, "cancelled")} className="btn-ghost btn-sm px-1.5" title="Cancel booking">
                                          <X size={14} />
                                        </ActionButton>
                                      </>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted">No bookings yet.</p>
                          )}
                          <p className="text-xs text-muted">
                            {active.length} of {c.capacity} spots taken{full ? ". The class is full." : "."}
                          </p>
                          {!full && c.is_active && <MemberSelect required label="Book a member" />}
                        </FormDialog>
                      );
                    })()}
                    <span className="flex">
                      <FormDialog title="Edit class" trigger={<Pencil size={12} />} triggerClass="btn-ghost btn-sm px-1.5" action={saveClass}>
                        <ClassFields c={c} trainers={trainers ?? []} />
                      </FormDialog>
                      <ActionButton action={deleteRecord.bind(null, "classes", c.id)} confirmLabel="Delete class" confirmText={`Delete ${c.name} on ${DAYS[c.day_of_week]} at ${fmtClock(c.start_time)}?`} successMessage="Class deleted" className="btn-danger btn-sm px-1.5">
                        <Trash2 size={12} />
                      </ActionButton>
                    </span>
                  </div>
                </div>
              ))}
              <FormDialog title={`New class on ${DAYS[d]}`} trigger={<><Plus size={12} /> Add</>} triggerClass="btn-ghost btn-sm w-full text-muted" action={saveClass}>
                <ClassFields trainers={trainers ?? []} day={d} />
              </FormDialog>
            </Card>
          );
        })}
      </div>
    </>
  );
}
