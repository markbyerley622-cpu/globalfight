import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";

// The operations console. One guard for the whole tree, so a new admin page
// cannot be added without access control — previously each page carried its own
// copy of the role check and a missed one would have been silently public.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage();

  const nav = [
    // Overview first — it is the page that answers "is anything waiting for
    // me", and until it existed /admin itself was a 404.
    { href: "/admin", label: "Overview" },
    { href: "/admin/events", label: "Events" },
    // Reports lead the community half of the nav: it is the only queue here
    // where the backlog is other members waiting on a decision.
    { href: "/admin/reports", label: "Reports" },
    { href: "/admin/claims", label: "Claims" },
    { href: "/admin/identity-verification", label: "Identity" },
    { href: "/admin/feedback", label: "Feedback" },
    { href: "/admin/data", label: "Data" },
    { href: "/admin/health", label: "Health" },
    { href: "/admin/analytics", label: "Analytics" },
  ];

  return (
    <div className="min-h-full bg-ink-950">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/95 backdrop-blur">
        <div className="flex items-center gap-4 px-4 py-2">
          <Link href="/admin" className="font-display text-sm font-black uppercase tracking-[0.16em] text-chalk">
            Operations
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-fog transition-colors hover:bg-ink-900 hover:text-chalk"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto text-2xs text-fog">
            {user.name ?? user.username} · {user.role}
          </span>
          <Link href="/" className="text-2xs text-fog transition-colors hover:text-chalk">Exit ↗</Link>
        </div>
      </header>
      {children}
    </div>
  );
}
