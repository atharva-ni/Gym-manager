import type { ReactNode } from "react";
import { Dumbbell } from "lucide-react";

/** Centered card used by the sign-in, forgot password and reset password screens. */
export function AuthCard({ subtitle, children, footer }: { subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 rounded-xl bg-brand p-3 text-brand-ink">
            <Dumbbell size={26} />
          </span>
          <h1 className="text-xl font-semibold">SetFit Fitness</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        <div className="card p-6">{children}</div>
        {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
      </div>
    </main>
  );
}
