"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, CalendarDays, ClipboardCheck, CreditCard, Dumbbell, LayoutDashboard, LogOut, Menu,
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
    { href: "/settings", label: "Settings", icon: Settings },
  ] },
];

export function Sidebar({ gymName, email, signOut }: { gymName: string; email: string; signOut: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <span className="flex items-center gap-2 font-semibold">
          <Dumbbell size={18} className="text-brand" /> {gymName}
        </span>
        <button className="btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
      </div>

      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-ink transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
            <span className="rounded-lg bg-brand p-1.5 text-white">
              <Dumbbell size={18} />
            </span>
            <span className="truncate font-semibold text-white">{gymName}</span>
          </Link>
          <button className="text-sidebar-ink lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{g.group}</p>
              <ul className="space-y-0.5">
                {g.items.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
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

        <div className="border-t border-white/10 p-3">
          <p className="truncate px-3 pb-2 text-xs text-white/50">{email}</p>
          <form action={signOut}>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-white">
              <LogOut size={17} /> Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
