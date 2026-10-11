import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";
import { SchemaCheck } from "@/components/schema-check";
import { getSettings, requireOwner } from "@/lib/auth";
import { signOut } from "@/app/actions";

// The session is read inside Suspense boundaries (here and in each page's
// loading.tsx) so the static shell can prerender. Every page also calls
// getSettings() → requireOwner(), and the proxy redirects signed-out visitors.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-screen">
      <Suspense fallback={<aside className="fixed inset-y-0 left-0 hidden w-64 bg-sidebar lg:block" />}>
        <SessionSidebar />
      </Suspense>
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Suspense>
            <SchemaCheck />
          </Suspense>
          {children}
        </div>
      </main>
    </div>
  );
}

async function SessionSidebar() {
  const user = await requireOwner();
  const settings = await getSettings();
  return <Sidebar gymName={settings.gym_name} email={user.email ?? ""} signOut={signOut} />;
}
