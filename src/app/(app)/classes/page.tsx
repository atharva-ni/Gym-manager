import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/auth";
import { fmtClock, todayISO } from "@/lib/format";
import { DAYS } from "@/lib/constants";
import type { GymClass } from "@/lib/types";
import { Card, PageHeader } from "@/components/ui";
import { ActionButton, FormDialog } from "@/components/forms";
import { Checkbox, Field, Grid, Hidden, SelectField } from "@/components/fields";
import { deleteRecord } from "@/app/actions";
import { saveClass } from "./actions";

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

export default async function ClassesPage() {
  const settings = await getSettings();
  const todayDow = new Date(`${todayISO(settings.timezone)}T12:00:00Z`).getUTCDay();
  const sb = await createClient();
  const [{ data }, { data: trainers }] = await Promise.all([
    sb.from("classes").select("*, trainers(full_name)").order("start_time"),
    sb.from("trainers").select("id, full_name").eq("status", "active").order("full_name"),
  ]);
  const classes = (data ?? []) as GymClass[];
  const weeklySpots = classes.filter((c) => c.is_active).reduce((s, c) => s + c.capacity, 0);

  return (
    <>
      <PageHeader
        title="Class schedule"
        description={`${classes.filter((c) => c.is_active).length} weekly classes · ${weeklySpots} spots per week`}
        actions={
          <FormDialog title="New class" trigger={<><Plus size={16} /> New class</>} action={saveClass}>
            <ClassFields trainers={trainers ?? []} />
          </FormDialog>
        }
      />
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
                  {d === todayDow && <span className="rounded bg-brand-soft px-1.5 text-[10px] font-semibold uppercase text-brand">Today</span>}
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
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Users size={12} /> {c.capacity}
                    </span>
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
