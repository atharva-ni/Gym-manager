import Form from "next/form";
import type { ReactNode } from "react";

/** GET form that drives `from`/`to` (and any extra) search params. */
export function DateRangeFilter({
  action,
  from,
  to,
  children,
}: {
  action: string;
  from: string;
  to: string;
  children?: ReactNode;
}) {
  return (
    <Form action={action} className="mb-4 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap [&_.input]:w-full sm:[&_.input]:w-auto">
      <label>
        <span className="label">From</span>
        <input type="date" name="from" defaultValue={from} className="input w-auto" />
      </label>
      <label>
        <span className="label">To</span>
        <input type="date" name="to" defaultValue={to} className="input w-auto" />
      </label>
      {children}
      <button className="btn-secondary col-span-2 sm:col-span-1">Apply</button>
    </Form>
  );
}
