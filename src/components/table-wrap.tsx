"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Wraps a `.tbl` table. On desktop it scrolls sideways if needed; on phones
 * the CSS turns each row into a stacked card, and this copies the column
 * header text onto each cell (`data-label`) so the card shows what each
 * value is. Rows added later (filters, new data) are labelled too.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const label = () => {
      el.querySelectorAll("table").forEach((table) => {
        const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
        table.querySelectorAll("tbody tr, tfoot tr").forEach((tr) => {
          let col = 0;
          Array.from(tr.children).forEach((cell) => {
            const span = (cell as HTMLTableCellElement).colSpan || 1;
            const text = span > 1 ? "" : (heads[col] ?? "");
            if (cell.getAttribute("data-label") !== text) cell.setAttribute("data-label", text);
            col += span;
          });
        });
      });
    };
    label();
    // Only watch for added/removed rows, so setting attributes doesn't re-trigger
    const observer = new MutationObserver(label);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="tbl-wrap overflow-x-auto">
      {children}
    </div>
  );
}
