import { Field, Grid, Hidden, SelectField, TextArea } from "@/components/fields";
import { options, PAYMENT_METHODS } from "@/lib/constants";
import type { Payment } from "@/lib/types";

/** Edit an existing payment. Member, fee and category stay as recorded. */
export function PaymentEditFields({ payment, today }: { payment: Payment; today: string }) {
  return (
    <>
      <Hidden name="id" value={payment.id} />
      <Grid>
        <Field label="Amount" name="amount" type="number" step="0.01" min={0.01} defaultValue={payment.amount} required />
        <Field label="Date" name="paid_on" type="date" max={today} defaultValue={payment.paid_on} required />
        <SelectField label="Method" name="method" defaultValue={payment.method} options={options(PAYMENT_METHODS)} />
        <Field label="UPI / transaction ref." name="reference" defaultValue={payment.reference ?? ""} />
      </Grid>
      <TextArea label="Notes" name="notes" rows={2} defaultValue={payment.notes} />
    </>
  );
}
