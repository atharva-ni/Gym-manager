import { redirect } from "next/navigation";
import { Dumbbell } from "lucide-react";
import { getOwner } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/fields";
import { signIn } from "./actions";

export const metadata = { title: "Sign in · SetFit Fitness" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getOwner()) redirect("/");
  const { error } = await props.searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 rounded-xl bg-brand p-3 text-brand-ink">
            <Dumbbell size={26} />
          </span>
          <h1 className="text-xl font-semibold">SetFit Fitness</h1>
          <p className="mt-1 text-sm text-muted">Owner sign in</p>
        </div>
        <div className="card p-6">
          {error === "unauthorized" && (
            <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              Please sign in with the owner account.
            </p>
          )}
          <ActionForm action={signIn}>
            <Field label="Email" name="email" type="email" autoComplete="email" required />
            <Field label="Password" name="password" type="password" autoComplete="current-password" required />
            <SubmitButton className="btn-primary w-full">Sign in</SubmitButton>
          </ActionForm>
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Owner accounts are created in the Supabase dashboard under Authentication → Users.
        </p>
      </div>
    </main>
  );
}
