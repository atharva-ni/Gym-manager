"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * "More" menu for a row's less common actions. Pass FormDialog /
 * ActionButton / ViewDialog / links as children; their buttons become full
 * width menu items with text. A drop-down on wide screens, a bottom sheet on
 * phones. The dialogs they open stay visible after the menu hides (see
 * `sheet` in forms.tsx).
 */
export function RowMenu({ children, label = "More" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button type="button" className="btn-ghost btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={16} /> {label}
      </button>
      {open && <div className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent" onClick={() => setOpen(false)} aria-hidden />}
      <div
        role="menu"
        // Choosing an item closes the menu; its dialog (a child) stays open
        onClickCapture={() => setTimeout(() => setOpen(false), 0)}
        className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-line bg-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1 sm:w-56 sm:rounded-xl sm:pb-2 ${
          open ? "visible" : "pointer-events-none invisible"
        } [&>a]:flex [&>a]:min-h-11 [&>a]:w-full [&>a]:items-center [&>a]:justify-start [&>a]:gap-2 [&>a]:sm:min-h-9 [&>button]:min-h-11 [&>button]:w-full [&>button]:justify-start [&>button]:sm:min-h-9`}
      >
        {children}
      </div>
    </div>
  );
}
