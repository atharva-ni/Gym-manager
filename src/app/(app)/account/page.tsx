import { requireAccess } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PasswordField } from "@/components/password-field";
import { changePassword } from "../settings/actions";

export const metadata = { title: "My account · SetFit Fitness" };

/** Staff: their own login. (The owner manages everything in Settings.) */
export default async function AccountPage() {
  const { user, role, name } = await requireAccess();
  return (
    <>
      <PageHeader title="My account" description={role === "staff" ? "Your staff login." : "Your login. Gym settings are under Settings."} />
      <div className="grid max-w-3xl gap-6 md:grid-cols-2">
        <Card title="Signed in as">
          <p className="font-medium text-ink">{name ?? "Owner"}</p>
          <p className="text-sm text-muted">{user.email}</p>
          <p className="mt-3 text-xs text-muted">
            {role === "staff"
              ? "You can check members in, view members and collect fees. Ask the owner to change your email or access."
              : "Full access."}
          </p>
        </Card>
        <Card title="Change password">
          <ActionForm action={changePassword} successMessage="Password updated." resetOnSuccess>
            <PasswordField label="New password" name="password" autoComplete="new-password" minLength={8} />
            <PasswordField label="Confirm password" name="confirm" autoComplete="new-password" minLength={8} />
            <SubmitButton className="btn-secondary w-full">Update password</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
