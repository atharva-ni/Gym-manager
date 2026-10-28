import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/fields";
import { PasswordField } from "@/components/password-field";
import { signOut } from "@/app/actions";
import { signIn } from "./actions";
import { AuthCard } from "./auth-card";

export const metadata = { title: "Sign in · SetFit Fitness" };

export default async function LoginPage(props: PageProps<"/login">) {
  const access = await getAccess();
  if (access) redirect(access.role === "staff" ? "/attendance" : "/");
  const { error } = await props.searchParams;

  return (
    <AuthCard
      subtitle="Sign in"
      footer={
        <Link href="/forgot" className="font-medium text-brand hover:underline">
          Forgot password?
        </Link>
      }
    >
      {error === "unauthorized" && (
        <div className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          <p>This account can&apos;t open the gym. Sign in with the owner account or a staff login the owner added.</p>
          <form action={signOut} className="mt-2">
            <button className="font-medium underline">Sign out of this account</button>
          </form>
        </div>
      )}
      <ActionForm action={signIn}>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <PasswordField label="Password" name="password" />
        <SubmitButton className="btn-primary w-full">Sign in</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
