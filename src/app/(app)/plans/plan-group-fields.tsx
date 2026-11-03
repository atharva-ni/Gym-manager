"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { durationLabel, perMonth, savingPct, type PlanGroup, type PlanKindName } from "@/lib/plans";

type Opt = {
  id?: string;
  duration_months: number | null;
  duration_days: number | null;
  price: string;
  active: boolean;
  /** Members currently on this option (can't be deleted, only switched off). */
  sold?: number;
};

const QUICK_MONTHS = [1, 3, 6, 12];

/**
 * One plan (e.g. "Silver") with all its durations and prices. Posts the
 * options as JSON for save_plan_group. PT packages have one "sessions per
 * month" number; each duration gets that many per month (12 x 3 = 36).
 */
export function PlanGroupFields({
  kind,
  group,
  activeCounts = {},
}: {
  kind: PlanKindName;
  group?: PlanGroup;
  activeCounts?: Record<string, number>;
}) {
  const isPT = kind === "personal_training";
  const isPass = kind === "pass";
  const [opts, setOpts] = useState<Opt[]>(
    group
      ? group.options.map((o) => ({
          id: o.id,
          duration_months: o.duration_months,
          duration_days: o.duration_months ? null : o.duration_days,
          price: String(Number(o.price)),
          active: o.is_active,
          sold: activeCounts[o.id] ?? 0,
        }))
      : isPass
        ? [{ duration_months: null, duration_days: 1, price: "", active: true }]
        : [{ duration_months: 1, duration_days: null, price: "", active: true }],
  );
  const first = group?.options.find((o) => o.duration_months);
  const [perMonthSessions, setPerMonthSessions] = useState(
    // Editing: work it out from an existing duration; empty = unlimited
    !group ? "12" : first?.sessions && first.duration_months ? String(Math.round(first.sessions / first.duration_months)) : "",
  );
  const perMonthN = Number(perMonthSessions) > 0 ? Math.round(Number(perMonthSessions)) : null;
  const sessionsFor = (o: Pick<Opt, "duration_months">) => (isPT && perMonthN && o.duration_months ? perMonthN * o.duration_months : null);
  const [customMonths, setCustomMonths] = useState("");
  const [customDays, setCustomDays] = useState("");

  const has = (o: Partial<Opt>) =>
    opts.some((x) => (o.duration_months ? x.duration_months === o.duration_months : x.duration_days === o.duration_days));
  const add = (months: number | null, days: number | null) => {
    if (!(months || days) || has({ duration_months: months, duration_days: days })) return;
    const next = [...opts, { duration_months: months, duration_days: days, price: "", active: true }];
    const len = (o: Opt) => (o.duration_months ? o.duration_months * 31 : (o.duration_days ?? 0));
    setOpts(next.sort((a, b) => len(a) - len(b)));
  };
  const update = (i: number, patch: Partial<Opt>) => setOpts(opts.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const remove = (i: number) => setOpts(opts.filter((_, j) => j !== i));

  const payload = opts.map((o) => ({
    id: o.id,
    duration_months: o.duration_months,
    duration_days: o.duration_days,
    price: o.price === "" ? null : Number(o.price),
    sessions: sessionsFor(o),
    active: o.active,
  }));
  const priced = opts.map((o) => ({ duration_months: o.duration_months, price: Number(o.price) || 0 }));

  return (
    <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="old_name" value={group?.name ?? ""} />
      <input type="hidden" name="options" value={JSON.stringify(payload)} />
      <label className="block">
        <span className="label">
          {isPT ? "Package name" : isPass ? "Pass name" : "Plan name"}
          <span className="text-bad"> *</span>
        </span>
        <input
          name="name"
          className="input"
          defaultValue={group?.name}
          required
          autoComplete="off"
          placeholder={isPT ? "e.g. PT 12 sessions / month" : isPass ? "e.g. Day pass, Trial week" : "e.g. Silver, Gold, Platinum"}
        />
      </label>
      <label className="block">
        <span className="label">What&apos;s included</span>
        <input name="description" className="input" defaultValue={group?.description ?? ""} placeholder="e.g. Gym floor, locker, steam" />
      </label>

      {isPT && (
        <label className="block">
          <span className="label">Sessions per month</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            className="input"
            placeholder="Unlimited"
            value={perMonthSessions}
            onChange={(e) => setPerMonthSessions(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted">Each duration gets this many a month (12 a month = 36 for 3 months). Leave empty for unlimited.</span>
        </label>
      )}

      <div>
        <p className="label">Durations and prices</p>
        <ul className="space-y-2">
          {opts.map((o, i) => {
            const save = savingPct(priced[i], priced);
            const pm = perMonth(priced[i]);
            return (
              <li key={o.id ?? `new-${o.duration_months ?? "d"}-${o.duration_days ?? ""}`} className="rounded-lg border border-line p-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-sm font-medium text-ink sm:w-20">
                    {durationLabel({ duration_months: o.duration_months, duration_days: o.duration_days ?? 1 })}
                  </span>
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Price</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      required
                      className="input"
                      placeholder="Price"
                      value={o.price}
                      onChange={(e) => update(i, { price: e.target.value })}
                    />
                  </label>
                  {isPT && (
                    <span className="w-20 shrink-0 text-right text-xs text-muted">
                      {sessionsFor(o) ? `${sessionsFor(o)} sessions` : "Unlimited"}
                    </span>
                  )}
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-2" title="Untick to stop selling this duration">
                    <input type="checkbox" checked={o.active} onChange={(e) => update(i, { active: e.target.checked })} className="size-4 accent-[var(--brand)]" />
                    <span className="hidden min-[400px]:inline">On sale</span>
                    <span className="sr-only min-[400px]:hidden">On sale</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={opts.length === 1}
                    className="btn-ghost btn-sm shrink-0 px-1.5"
                    aria-label={`Remove ${durationLabel({ duration_months: o.duration_months, duration_days: o.duration_days ?? 1 })}`}
                  >
                    <X size={14} />
                  </button>
                </div>
                {(pm || save || o.sold) && Number(o.price) > 0 ? (
                  <p className="mt-1 text-xs text-muted">
                    {pm && o.duration_months !== 1 ? `₹${pm.toLocaleString("en-IN")} a month` : ""}
                    {save ? <span className="text-good"> · saves {save}% vs monthly</span> : null}
                    {o.sold ? ` · ${o.sold} active member${o.sold === 1 ? "" : "s"} (removing it only stops new sales)` : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {isPass ? (
            <>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                className="input w-24"
                placeholder="Days"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
              />
              <button type="button" className="btn-secondary btn-sm" onClick={() => { add(null, Number(customDays) || null); setCustomDays(""); }}>
                <Plus size={14} /> Add days
              </button>
            </>
          ) : (
            <>
              {QUICK_MONTHS.filter((m) => !has({ duration_months: m })).map((m) => (
                <button key={m} type="button" className="btn-secondary btn-sm" onClick={() => add(m, null)}>
                  <Plus size={14} /> {durationLabel({ duration_months: m, duration_days: m * 30 })}
                </button>
              ))}
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={36}
                  className="input w-24"
                  placeholder="Months"
                  aria-label="Other number of months"
                  value={customMonths}
                  onChange={(e) => setCustomMonths(e.target.value)}
                />
                <button type="button" className="btn-ghost btn-sm" onClick={() => { add(Number(customMonths) || null, null); setCustomMonths(""); }}>
                  Add
                </button>
              </span>
            </>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="is_active" defaultChecked={group?.active ?? true} className="size-4 accent-[var(--brand)]" />
        Available for new sign-ups
      </label>
      {!isPass && <p className="text-xs text-muted">Months are calendar months: 15 Jan + 1 month runs to 14 Feb. The admission fee is set once in Settings.</p>}
    </>
  );
}
