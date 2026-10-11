"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";

export type ToastTone = "good" | "warn" | "bad";
type Toast = { id: number; text: string; tone: ToastTone };

const EVENT = "app-toast";

/** Show a short notification. Client-side only. */
export function toast(text: string, tone: ToastTone = "good") {
  window.dispatchEvent(new CustomEvent<Omit<Toast, "id">>(EVENT, { detail: { text, tone } }));
}

const STYLE: Record<ToastTone, string> = {
  good: "border-good/30 text-good",
  warn: "border-warn/30 text-warn",
  bad: "border-bad/30 text-bad",
};
const ICON = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle };

/** Renders toasts raised with `toast()`. Mounted once in the root layout. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 0;
    const onToast = (e: Event) => {
      const { text, tone } = (e as CustomEvent<Omit<Toast, "id">>).detail;
      const id = ++next;
      setItems((list) => [...list.slice(-3), { id, text, tone }]);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === "good" ? 3500 : 7000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:w-96" aria-live="polite">
      {items.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "bad" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-surface px-4 py-3 text-sm shadow-lg ${STYLE[t.tone]}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-ink">{t.text}</p>
            <button
              type="button"
              className="text-muted hover:text-ink"
              aria-label="Dismiss"
              onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
