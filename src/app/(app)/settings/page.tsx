import { Download } from "lucide-react";
import { getOwner, getSettings } from "@/lib/auth";
import { CURRENCIES } from "@/lib/constants";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Grid, SelectField, TextArea } from "@/components/fields";
import { PasswordField } from "@/components/password-field";
import { changeLoginEmail, changePassword, saveSettings } from "./actions";

export const metadata = { title: "Settings · SetFit Fitness" };

const EXPORTS = [
  { table: "members", label: "Members" },
  { table: "memberships", label: "Memberships" },
  { table: "payments", label: "Payments" },
  { table: "refunds", label: "Refunds" },
  { table: "freezes", label: "Freezes" },
  { table: "pt_sessions", label: "PT sessions" },
  { table: "expenses", label: "Expenses" },
  { table: "attendance", label: "Attendance" },
  { table: "sales", label: "POS sales" },
  { table: "leads", label: "Leads" },
];

export default async function SettingsPage() {
  const s = await getSettings();
  const owner = await getOwner();
  const zones = Intl.supportedValuesOf("timeZone");
  const currencies = CURRENCIES.includes(s.currency) ? CURRENCIES : [s.currency, ...CURRENCIES];

  return (
    <>
      <PageHeader title="Settings" description="Gym profile, preferences and account." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Gym profile" className="lg:col-span-2">
          <ActionForm action={saveSettings} successMessage="Settings saved.">
            <Grid>
              <Field label="Gym name" name="gym_name" defaultValue={s.gym_name} required />
              <Field label="Phone" name="phone" defaultValue={s.phone ?? ""} />
              <Field label="Email" name="email" type="email" defaultValue={s.email ?? ""} />
              <SelectField label="Currency" name="currency" defaultValue={s.currency} options={currencies.map((c) => ({ value: c, label: c }))} />
              <SelectField label="Timezone" name="timezone" defaultValue={s.timezone} options={zones.map((z) => ({ value: z, label: z }))} />
              <Field
                label="Expiry alert (days)"
                name="expiry_alert_days"
                type="number"
                min={1}
                max={60}
                defaultValue={s.expiry_alert_days}
                hint="Members are flagged as “expiring” this many days before their plan ends."
                required
              />
              <Field label="GST rate %" name="tax_rate" type="number" step="0.01" min={0} max={28} defaultValue={s.tax_rate} hint="Fees are treated as GST-inclusive; receipts show the GST part. Use 0 if not registered." />
            </Grid>
            <TextArea label="Address" name="address" rows={2} defaultValue={s.address} />
            <div className="rounded-lg border border-line p-3">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Freeze rules</p>
              <Grid>
                <Field
                  label="Max freeze days per plan"
                  name="freeze_max_days"
                  type="number"
                  min={1}
                  defaultValue={s.freeze_max_days ?? ""}
                  placeholder="No limit"
                  hint="Total across all freezes on one membership. Leave empty for no limit."
                />
                <Field
                  label="Freeze fee"
                  name="freeze_fee"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={s.freeze_fee ?? 0}
                  hint="Added to the member's dues each time a plan is frozen. 0 = free."
                />
              </Grid>
            </div>
            <p className="text-xs text-muted">Name, address and contact details appear on printed receipts.</p>
            <div className="flex justify-end">
              <SubmitButton>Save settings</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <div className="space-y-6">
          <Card title="Login email">
            <ActionForm action={changeLoginEmail} resetOnSuccess>
              <p className="text-sm text-ink-2">
                You sign in with <span className="font-medium text-ink">{owner?.email}</span>.
              </p>
              <Field label="New login email" name="email" type="email" autoComplete="email" required />
              <p className="text-xs text-muted">
                Add the new address to <code>OWNER_EMAILS</code> first. A confirmation link is emailed; the change applies after you click it.
              </p>
              <SubmitButton className="btn-secondary w-full">Change login email</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Change password">
            <ActionForm action={changePassword} successMessage="Password updated." resetOnSuccess>
              <PasswordField label="New password" name="password" autoComplete="new-password" minLength={8} />
              <PasswordField label="Confirm password" name="confirm" autoComplete="new-password" minLength={8} />
              <SubmitButton className="btn-secondary w-full">Update password</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Export data (CSV)">
            <div className="grid grid-cols-2 gap-2">
              {EXPORTS.map((e) => (
                <a key={e.table} href={`/export/${e.table}`} className="btn-secondary btn-sm justify-start">
                  <Download size={14} /> {e.label}
                </a>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
