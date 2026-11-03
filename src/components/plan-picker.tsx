"use client";

import { priceTag } from "@/lib/format";
import { durationLabel, perMonth, savingPct, type PlanGroup, type PlanOption } from "@/lib/plans";

/**
 * Pick a plan, then its duration: "Silver" / "Gold" chips, then tiles such
 * as "3 months ₹4,000 · ₹1,333/mo · save 11%". Posts the chosen option's id
 * as `name`. With `noneLabel`, a chip for "no plan on this bill".
 */
export function PlanPicker({
  name,
  groups,
  value,
  onChange,
  currency,
  noneLabel,
  sessions,
}: {
  name: string;
  groups: PlanGroup<PlanOption>[];
  value: string;
  onChange: (id: string) => void;
  currency: string;
  noneLabel?: string;
  /** Show the session count on each tile (PT). */
  sessions?: boolean;
}) {
  const current = groups.find((g) => g.options.some((o) => o.id === value));
  const option = current?.options.find((o) => o.id === value);

  const pickGroup = (g: PlanGroup<PlanOption>) => {
    // Keep the same length when switching Silver -> Gold, if Gold has it
    const same = option && g.options.find((o) => o.duration_months === option.duration_months && o.duration_days === option.duration_days);
    onChange((same ?? g.options[0]).id);
  };

  const chip = (selected: boolean) =>
    `inline-flex min-h-11 items-center rounded-lg border px-3.5 text-sm font-medium transition sm:min-h-9 ${
      selected ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-ink-2 hover:bg-surface-2"
    }`;

  return (
    <div className="space-y-3">
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Plan">
        {noneLabel && (
          <button type="button" role="radio" aria-checked={!value} className={chip(!value)} onClick={() => onChange("")}>
            {noneLabel}
          </button>
        )}
        {groups.map((g) => (
          <button key={g.name} type="button" role="radio" aria-checked={current === g} className={chip(current === g)} onClick={() => pickGroup(g)}>
            {g.name}
          </button>
        ))}
      </div>
      {current && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Duration">
          {current.options.map((o) => {
            const selected = o.id === value;
            const pm = perMonth(o);
            const save = savingPct(o, current.options);
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(o.id)}
                className={`rounded-lg border p-2.5 text-left transition ${
                  selected ? "border-brand bg-brand-soft ring-2 ring-brand/20" : "border-line bg-surface hover:bg-surface-2"
                }`}
              >
                <span className={`block text-xs font-medium ${selected ? "text-brand" : "text-muted"}`}>{durationLabel(o)}</span>
                <span className="block font-semibold tabular-nums text-ink">{priceTag(o.price, currency)}</span>
                <span className="block text-xs text-muted">
                  {sessions && (o.sessions ? `${o.sessions} sessions` : "Unlimited")}
                  {!sessions && pm && o.duration_months !== 1 ? `${priceTag(pm, currency)}/mo` : null}
                  {save ? <span className="whitespace-nowrap text-good"> · save {save}%</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {current?.description && <p className="text-xs text-muted">{current.description}</p>}
    </div>
  );
}
