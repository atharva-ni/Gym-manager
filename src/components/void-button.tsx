import { Ban } from "lucide-react";
import { FormDialog } from "@/components/forms";
import { voidRecord } from "@/app/actions";

/**
 * Void a payment, refund or sale. The owner gives a reason; the record leaves
 * the books and the activity log keeps a full copy with who voided it and why.
 */
export function VoidButton({ table, id, what, note }: { table: "payments" | "refunds" | "sales"; id: string; what: string; note?: string }) {
  return (
    <FormDialog
      title={`Void ${what}`}
      trigger={
        <>
          <Ban size={14} />
          <span className="sr-only">Void</span>
        </>
      }
      triggerClass="btn-danger btn-sm"
      action={voidRecord.bind(null, table, id)}
      submitLabel="Void"
      successMessage="Voided. The activity log keeps a copy."
    >
      <p className="text-sm text-ink-2">
        Use this for mistakes only. {note ?? "It is removed from totals and dues."} The activity log keeps the record, with your reason.
      </p>
      <label className="block">
        <span className="label">
          Reason<span className="text-bad"> *</span>
        </span>
        <textarea name="reason" rows={2} required minLength={3} placeholder="e.g. Entered twice, wrong member" className="input" />
      </label>
    </FormDialog>
  );
}
