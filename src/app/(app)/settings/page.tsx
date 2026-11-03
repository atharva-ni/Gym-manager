import Link from "next/link";
import { Download } from "lucide-react";
import { getSettings, requireOwner } from "@/lib/auth";
import { logoUrlFor } from "@/lib/brand";
import { CURRENCIES } from "@/lib/constants";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Grid, SelectField, TextArea } from "@/components/fields";
import { PasswordField } from "@/components/password-field";
import { changeLoginEmail, changePassword, saveGymProfile, saveRules } from "./actions";

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
  const { user: owner } = await requireOwner();
  const s = await getSettings();
  const logo = logoUrlFor(s.logo_path);
  // Browsers still list India as the old "Asia/Calcutta"; show the current name first
  const zones = ["Asia/Kolkata", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "Asia/Calcutta" && z !== "Asia/Kolkata")];
  const timezone = s.timezone === "Asia/Calcutta" ? "Asia/Kolkata" : s.timezone;
  const currencies = CURRENCIES.includes(s.currency) ? CURRENCIES : [s.currency, ...CURRENCIES];

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          <>
            Gym details, rules and your account. Plans and the admission fee are on{" "}
            <Link href="/plans" className="text-brand hover:underline">
              Plans
            </Link>
            ; staff logins and their discount limit on{" "}
            <Link href="/trainers" className="text-brand hover:underline">
              Staff
            </Link>
            .
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card title="Gym profile">
          <ActionForm action={saveGymProfile} successMessage="Gym profile saved.">
            <p className="text-sm text-muted">Shown on printed receipts, the receipt links you send on WhatsApp and the sign-in screen.</p>
            <div className="flex items-center gap-4">
              <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo from storage
                  <img src={logo} alt="Gym logo" className="size-full object-contain p-1" />
                ) : (
                  <span className="text-xs text-muted">No logo</span>
                )}
              </span>
              <div className="min-w-0 space-y-1.5">
                <label className="block">
                  <span className="label">Logo</span>
                  <input
                    type="file"
                    name="logo"
                    accept="image/png,image/jpeg,image/webp"
                    className="input file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-sm"
                  />
                </label>
                <p className="text-xs text-muted">PNG with a clear background works best. Up to 2 MB.</p>
                {logo && (
                  <label className="flex items-center gap-2 text-xs text-ink-2">
                    <input type="checkbox" name="remove_logo" className="size-4 accent-[var(--brand)]" /> Remove logo
                  </label>
                )}
              </div>
            </div>
            <Field label="Gym name" name="gym_name" defaultValue={s.gym_name} required />
            <Grid>
              <Field label="Phone" name="phone" type="tel" defaultValue={s.phone ?? ""} />
              <Field label="Email" name="email" type="email" defaultValue={s.email ?? ""} />
            </Grid>
            <TextArea label="Address" name="address" rows={2} defaultValue={s.address} />
            <Field
              label="GST rate %"
              name="tax_rate"
              type="number"
              step="0.01"
              min={0}
              max={28}
              defaultValue={s.tax_rate}
              hint="Fees are GST-inclusive; receipts show the GST part. 0 if not registered."
            />
            <div className="flex justify-end">
              <SubmitButton>Save profile</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="Rules">
          <ActionForm action={saveRules} successMessage="Rules saved.">
            <Grid>
              <SelectField label="Currency" name="currency" defaultValue={s.currency} options={currencies.map((c) => ({ value: c, label: c }))} />
              <SelectField label="Timezone" name="timezone" defaultValue={timezone} options={zones.map((z) => ({ value: z, label: z }))} />
            </Grid>
            <Field
              label="Expiry alert (days)"
              name="expiry_alert_days"
              type="number"
              min={1}
              max={60}
              defaultValue={s.expiry_alert_days}
              hint="Members show as “expiring” this many days before their plan ends."
              required
            />
            <Grid>
              <Field
                label="Max freeze days per plan"
                name="freeze_max_days"
                type="number"
                min={1}
                defaultValue={s.freeze_max_days ?? ""}
                placeholder="No limit"
                hint="All freezes on one plan together."
              />
              <Field
                label="Freeze fee"
                name="freeze_fee"
                type="number"
                step="0.01"
                min={0}
                defaultValue={s.freeze_fee ?? 0}
                hint="Added to dues on each freeze. 0 = free."
              />
            </Grid>
            <div className="flex justify-end">
              <SubmitButton>Save rules</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink">Account and data</h2>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Login email">
          <ActionForm action={changeLoginEmail} resetOnSuccess>
            <p className="text-sm text-ink-2">
              You sign in with <span className="break-all font-medium text-ink">{owner.email}</span>.
            </p>
            <Field label="New login email" name="email" type="email" autoComplete="email" required />
            <p className="text-xs text-muted">A confirmation link is emailed; the change applies after you click it.</p>
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
        <Card title="Export data (CSV)" className="md:col-span-2 xl:col-span-1">
          <p className="mb-3 text-sm text-muted">Download a copy for your accountant or as a backup.</p>
          <div className="grid grid-cols-2 gap-2">
            {EXPORTS.map((e) => (
              <a key={e.table} href={`/export/${e.table}`} className="btn-secondary btn-sm justify-start">
                <Download size={14} /> {e.label}
              </a>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
