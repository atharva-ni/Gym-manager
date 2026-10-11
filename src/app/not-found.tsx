import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-sm p-6 text-center">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-muted">This record doesn’t exist or was deleted.</p>
        <Link href="/" className="btn-primary mt-4">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
