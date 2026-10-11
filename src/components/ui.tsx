import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  bodyClass = "p-5",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "brand" | "good" | "warn" | "bad";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  brand: "bg-brand-soft text-brand",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
  href,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  href?: string;
  tone?: Tone;
}) {
  const body = (
    <div className="card h-full p-4 transition hover:border-brand/40">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {icon && <span className={`rounded-lg p-1.5 ${toneClass[tone]}`}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-muted">{children}</p>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const parts = name.split(/\s+/).filter(Boolean);
  const text = parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  const dims = size === "lg" ? "size-14 text-lg" : "size-8 text-xs";
  return (
    <span className={`inline-flex ${dims} shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand`}>
      {text}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  active: "good",
  working: "good",
  converted: "good",
  paid: "good",
  frozen: "brand",
  trial: "brand",
  contacted: "brand",
  new: "neutral",
  inactive: "neutral",
  retired: "neutral",
  expiring: "warn",
  needs_service: "warn",
  due: "warn",
  expired: "bad",
  cancelled: "bad",
  out_of_order: "bad",
  lost: "bad",
  none: "neutral",
  upcoming: "brand",
};

export function StatusBadge({ status }: { status: string }) {
  const text = status.replace(/_/g, " ");
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{text[0].toUpperCase() + text.slice(1)}</Badge>;
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1 text-sm w-fit">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-md px-3 py-1.5 font-medium ${
            current === t.key ? "bg-brand text-brand-ink" : "text-ink-2 hover:bg-surface-2"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
