import { Suspense, type ReactNode } from "react";
import { Dumbbell } from "lucide-react";
import { DEFAULT_GYM_NAME, getBrand } from "@/lib/brand";

function Mark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo from storage
        <img src={logoUrl} alt="" className="mb-3 size-14 rounded-xl object-contain" />
      ) : (
        <span className="mb-3 rounded-xl bg-brand p-3 text-brand-ink">
          <Dumbbell size={26} />
        </span>
      )}
      <h1 className="text-xl font-semibold">{name}</h1>
    </>
  );
}

async function GymMark() {
  const { name, logoUrl } = await getBrand();
  return <Mark name={name} logoUrl={logoUrl} />;
}

/** Centered card used by the sign-in, forgot password and reset password screens. */
export function AuthCard({ subtitle, children, footer }: { subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Suspense fallback={<Mark name={DEFAULT_GYM_NAME} logoUrl={null} />}>
            <GymMark />
          </Suspense>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        <div className="card p-6">{children}</div>
        {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
      </div>
    </main>
  );
}
