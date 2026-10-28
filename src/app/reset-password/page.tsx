import { ActionForm, SubmitButton } from "@/components/forms";
import { PasswordField } from "@/components/password-field";
import { setNewPassword } from "../login/actions";
import { AuthCard } from "../login/auth-card";

export const metadata = { title: "New password · SetFit Fitness" };

/** Opened from the reset email: the link has already signed the user in. */
export default function ResetPasswordPage() {
  return (
    <AuthCard subtitle="Choose a new password">
      <ActionForm action={setNewPassword}>
        <PasswordField label="New password" name="password" autoComplete="new-password" minLength={8} />
        <PasswordField label="Confirm password" name="confirm" autoComplete="new-password" minLength={8} />
        <SubmitButton className="btn-primary w-full">Save and sign in</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
