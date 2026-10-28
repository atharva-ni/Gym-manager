"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, CalendarDays, ClipboardCheck, CreditCard, Dumbbell, History, KeyRound, LayoutDashboard, LogOut, Menu,
  Package, Settings, Tags, UserPlus, UserRound, Users, Wallet, Wrench, X,
} from "lucide-react";

const NAV = [
  { group: "Overview", items: [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/reports", label: "Reports", icon: BarChart3 },
  ] },
  { group: "Members", items: [
    { href: "/members", label: "Members", icon: Users },
    { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
    { href: "/leads", label: "Leads", icon: UserPlus },
    { href: "/plans", label: "Plans & packages", icon: Tags },
  ] },
  { group: "Finance", items: [
    { href: "/payments", label: "Fees & payments", icon: CreditCard },
    { href: "/expenses", label: "Expenses", icon: Wallet },
    { href: "/inventory", label: "Inventory & POS", icon: Package },
  ] },
  { group: "Operations", items: [
    { href: "/trainers", label: "Staff", icon: UserRound },
    { href: "/classes", label: "Classes", icon: CalendarDays },
    { href: "/equipment", label: "Equipment", icon: Wrench },
    { href: "/activity", label: "Activity log", icon: History },
    { href: "/settings", label: "Settings", icon: Settings },
  ] },
];

/** Staff logins: the front-desk screens only (the database enforces the same limits). */
const STAFF_NAV = [
  { group: "Front desk", items: [
    { href: "/attendance", label: "Check-in", icon: ClipboardCheck },
    { href: "/members", label: "Members", icon: Users },
    { href: "/payments", label: "Fees & payments", icon: CreditCard },
    { href: "/account", label: "My account", icon: KeyRound },
  ] },
];

/** Phone bottom bar: the four daily front-desk screens, plus More for everything else. */
const TABS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/members", label: "Members", icon: Users },
  { href: "/attendance", label: "Check-in", icon: ClipboardCheck },
  { href: "/payments", label: "Fees", icon: CreditCard },
];
const STAFF_TABS = [
  { href: "/attendance", label: "Check-in", icon: ClipboardCheck },
  { href: "/members", label: "Members", icon: Users },
  { href: "/payments", label: "Fees", icon: CreditCard },
  { href: "/account", label: "Account", icon: KeyRound },
];

/**
 * Navigation. Desktop: fixed sidebar. Phones: slim top bar, a bottom tab bar
 * for the daily screens, and the full menu in a drawer opened from "More".
 */
export function Sidebar({
  gymName,
  email,
  staffName,
  signOut,
}: {
  gymName: string;
  email: string;
  /** Set for staff logins, which get the front-desk menu only. */
  staffName: string | null;
  signOut: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isStaff = staffName !== null;
  const nav = isStaff ? STAFF_NAV : NAV;
  const tabs = isStaff ? STAFF_TABS : TABS;
  const home = isStaff ? "/attendance" : "/";
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const inTabs = tabs.some((t) => isActive(t.href));

  // Close the drawer with Escape, and stop the page behind it scrolling
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur lg:hidden">
        <Link href={home} className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="rounded-lg bg-brand p-1.5 text-white">
            <Dumbbell size={16} />
          </span>
          <span className="truncate">{gymName}</span>
        </Link>
        {!isStaff && (
          <Link href="/members/new" className="btn-primary btn-sm shrink-0" aria-label="New admission">
            <UserPlus size={16} /> <span className="hidden min-[380px]:inline">Admission</span>
          </Link>
        )}
      </header>

      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        aria-label="Main menu"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-ink transition-transform lg:w-64 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 lg:py-5">
          <Link href={home} className="flex min-w-0 items-center gap-2.5" onClick={() => setOpen(false)}>
            <span className="rounded-lg bg-brand p-1.5 text-white">
              <Dumbbell size={18} />
            </span>
            <span className="truncate font-semibold text-white">{gymName}</span>
          </Link>
          <button
            className="-mr-2 flex size-11 items-center justify-center rounded-lg text-sidebar-ink hover:bg-white/5 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {nav.map((g) => (
            <div key={g.group}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{g.group}</p>
              <ul className="space-y-0.5">
                {g.items.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive(href) ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition lg:min-h-0 lg:text-sm ${
                        isActive(href) ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <Icon size={17} />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="truncate px-3 pb-2 text-xs text-white/50">{isStaff ? `${staffName} (staff) · ${email}` : email}</p>
          <form action={signOut}>
            <button className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-white lg:min-h-0">
              <LogOut size={17} /> Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Phone bottom tab bar */}
      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                    active ? "text-brand" : "text-muted"
                  }`}
                >
                  <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                  {label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                !inTabs ? "text-brand" : "text-muted"
              }`}
            >
              <Menu size={20} strokeWidth={!inTabs ? 2.4 : 2} />
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
