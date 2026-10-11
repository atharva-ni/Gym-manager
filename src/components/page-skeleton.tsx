/** Placeholder shown while a page's data loads (used by every route's loading.tsx). */
export function PageSkeleton({ stats = 4, variant = "table" }: { stats?: number; variant?: "table" | "profile" | "form" }) {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-lg bg-surface-2" />
          <div className="h-4 w-72 max-w-full rounded bg-surface-2" />
        </div>
        <div className="hidden h-9 w-36 rounded-lg bg-surface-2 sm:block" />
      </div>
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="h-24 rounded-xl bg-surface-2" />
          ))}
        </div>
      )}
      {variant === "profile" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-80 rounded-xl bg-surface-2" />
          <div className="h-80 rounded-xl bg-surface-2 lg:col-span-2" />
        </div>
      ) : variant === "form" ? (
        <div className="space-y-6">
          <div className="h-56 rounded-xl bg-surface-2" />
          <div className="h-72 rounded-xl bg-surface-2" />
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
              <div className="size-8 rounded-full bg-surface-2" />
              <div className="h-4 flex-1 rounded bg-surface-2" />
              <div className="h-4 w-24 rounded bg-surface-2" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
