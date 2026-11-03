import { LogOut } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { Avatar, Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PasswordField } from "@/components/password-field";
import { signOut } from "@/app/actions";
import { changePassword } from "../settings/actions";

export const metadata = { title: "My account · SetFit Fitness" };

/** Your own login: who you're signed in as, change password, sign out. */
export default async function AccountPage() {
  const { user, role, name } = await requireAccess();
  const displayName = name ?? "Owner";
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="My account" />
      <Card bodyClass="">
        <div className="flex items-center gap-4 p-5">
          <Avatar name={displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
              {displayName}
              <Badge tone={role === "owner" ? "brand" : "neutral"}>{role === "owner" ? "Owner" : "Staff"}</Badge>
            </p>
            <p className="break-all text-sm text-muted">{user.email}</p>
          </div>
        </div>

        <div className="border-t border-line p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Change password</h2>
          <ActionForm action={changePassword} successMessage="Password updated." resetOnSuccess>
            <PasswordField label="New password" name="password" autoComplete="new-password" minLength={8} />
            <PasswordField label="Confirm password" name="confirm" autoComplete="new-password" minLength={8} />
            <div className="flex justify-end">
              <SubmitButton>Update password</SubmitButton>
            </div>
          </ActionForm>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line p-5">
          <p className="text-sm text-muted">{role === "staff" ? "To change your email, ask the gym owner." : "Gym details are in Settings."}</p>
          <form action={signOut}>
            <button className="btn-secondary">
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </div>
      </Card>
    </div>
  );
}
