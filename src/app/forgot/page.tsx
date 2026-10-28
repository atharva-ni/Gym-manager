import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/fields";
import { sendPasswordReset } from "../login/actions";
import { AuthCard } from "../login/auth-card";

export const metadata = { title: "Forgot password · SetFit Fitness" };

export default async function ForgotPasswordPage(props: PageProps<"/forgot">) {
  const { expired } = await props.searchParams;
  return (
    <AuthCard
      subtitle="Reset your password"
      footer={
        <Link href="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      }
    >
      {expired && (
        <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          That link has expired or was already used. Ask for a new one below.
        </p>
      )}
      <ActionForm action={sendPasswordReset} resetOnSuccess>
        <p className="text-sm text-ink-2">Enter your login email. We&apos;ll email you a link to set a new password.</p>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <SubmitButton className="btn-primary w-full">Send reset link</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
