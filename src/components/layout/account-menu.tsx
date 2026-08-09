"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Settings, Bookmark, TrendingUp, LogOut, CircleUserRound, Menu, Home, ShieldCheck, Megaphone, BadgeCheck, BarChart3, MessageSquarePlus } from "lucide-react";
import { useAuth } from "@/lib/auth-client";
import { isAdminRole } from "@/lib/admin/roles";
import { cn } from "@/lib/utils";

/**
 * Account button + dropdown for the top bar — works on desktop and mobile.
 * Gives a signed-in user one-tap access to Profile, Predictions, Saved,
 * Settings and Log out; guests get Sign in / Create account. "Browse menu"
 * opens the full nav sheet, so nothing is lost. Every link resolves to a real
 * route (/profile, /predictions, /library, /account).
 */
export function AccountMenu({ onOpenNav }: { onOpenNav: () => void }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = user ? (user.name ?? user.username ?? "?").slice(0, 1).toUpperCase() : null;
  // Whether to OFFER the admin link, not whether it may be used — every admin
  // page and route re-checks server-side. Still the shared predicate: a copy
  // that drifts would hide the link from real staff, which reads as the admin
  // area being broken. lib/admin/roles imports nothing, so it is safe here in a
  // client component.
  const isAdmin = user ? isAdminRole(user.role) : false;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-lg border-2 border-blood-500 bg-ink-950 font-display text-xs font-bold text-blood-400 shadow-[0_0_12px_-3px_rgba(225,29,42,0.55)] transition-transform active:scale-95"
      >
        {initial ?? <User className="size-4" />}
      </button>

      {open && (
        <div
          role="menu"
          className="rise absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 overflow-hidden rounded-card border border-ink-700 bg-ink-900 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.85)]"
        >
          {/* Identity */}
          <div className="flex items-center gap-3 border-b border-ink-800 bg-ink-850 p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-blood-500 bg-ink-950 font-display text-sm font-bold text-blood-400">
              {initial ?? <User className="size-4" />}
            </span>
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-bold text-chalk">
                {user ? user.username ?? user.name ?? "Fan" : "Guest fan"}
              </div>
              <div className="truncate text-2xs text-mist">{user ? user.email : "Not signed in"}</div>
            </div>
          </div>

          <nav className="p-1.5">
            <Item href="/" icon={<Home className="size-4" />} onClick={() => setOpen(false)}>Home</Item>
            {user ? (
              <>
                <Item href="/profile" icon={<CircleUserRound className="size-4" />} onClick={() => setOpen(false)}>Profile</Item>
                <Item href="/predictions/mine" icon={<TrendingUp className="size-4" />} onClick={() => setOpen(false)}>My Predictions</Item>
                <Item href="/library" icon={<Bookmark className="size-4" />} onClick={() => setOpen(false)}>Saved</Item>
                {/* ── Host events: promoters only ──
                    This used to render for every signed-in account, on the
                    reasoning that `registryRole` must not gate it — which is
                    correct, and is why the condition below is NOT registryRole.
                    `isPromoter` is derived from real rows: owning a promotion,
                    or having applied for one. A fan who has never applied has
                    no use for a hosting dashboard in their account menu.

                    Hiding it grants nothing and withholds nothing: /promoter
                    resolves the true state through lib/promoter/verification
                    and refuses on the capability table regardless of how the
                    reader got there. The way IN for a new promoter is the
                    "Claim your profile" card on /account, which every account
                    sees. */}
                {user.isPromoter && (
                  <Item href="/promoter" icon={<Megaphone className="size-4" />} onClick={() => setOpen(false)}>Host events</Item>
                )}
                <Item href="/feedback" icon={<MessageSquarePlus className="size-4" />} onClick={() => setOpen(false)}>Feedback</Item>
                <Item href="/account" icon={<Settings className="size-4" />} onClick={() => setOpen(false)}>Settings</Item>
                {/* ── ADMIN ──
                    Was two loose links sitting among the user's own items, and
                    one of them was mislabelled: "Verification" pointed at
                    /admin/claims, which is FIGHTER CLAIMS — a different queue
                    from identity verification, with different documents and a
                    different decision. Identity verification and the analytics
                    console had no entry point at all, so the only way to reach
                    either was to already know the URL.

                    Now a titled section with the console's own front door at
                    the top. Ordinary users never render this branch, and every
                    destination re-checks server-side regardless: the admin
                    layout calls requireAdminPage() for the whole tree. Hiding
                    the links is discoverability, not access control. */}
                {isAdmin && (
                  <>
                    <div className="my-1 border-t border-ink-800" />
                    <p className="px-3 pb-1 pt-1.5 font-display text-3xs font-bold uppercase tracking-[0.16em] text-fog">
                      Admin
                    </p>
                    <Item href="/admin" icon={<ShieldCheck className="size-4" />} onClick={() => setOpen(false)}>Operations</Item>
                    <Item href="/admin/identity-verification" icon={<BadgeCheck className="size-4" />} onClick={() => setOpen(false)}>Verification</Item>
                    <Item href="/admin/analytics" icon={<BarChart3 className="size-4" />} onClick={() => setOpen(false)}>Analytics</Item>
                  </>
                )}
                <Action icon={<Menu className="size-4" />} onClick={() => { setOpen(false); onOpenNav(); }}>Browse menu</Action>
                <div className="my-1 border-t border-ink-800" />
                <Action icon={<LogOut className="size-4" />} danger onClick={async () => { setOpen(false); await logout(); }}>Log out</Action>
              </>
            ) : (
              <>
                <Item href="/account" icon={<User className="size-4" />} onClick={() => setOpen(false)}>Sign in</Item>
                <Item href="/account" icon={<CircleUserRound className="size-4" />} onClick={() => setOpen(false)}>Create account</Item>
                <Action icon={<Menu className="size-4" />} onClick={() => { setOpen(false); onOpenNav(); }}>Browse menu</Action>
              </>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}

const rowCls =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors";

function Item({ href, icon, children, onClick }: { href: string; icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <Link role="menuitem" href={href} onClick={onClick} className={cn(rowCls, "text-mist hover:bg-ink-800 hover:text-chalk")}>
      <span className="text-fog">{icon}</span>
      {children}
    </Link>
  );
}

function Action({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cn(rowCls, danger ? "text-blood-300 hover:bg-blood-500/10" : "text-mist hover:bg-ink-800 hover:text-chalk")}>
      <span className={danger ? "text-blood-400" : "text-fog"}>{icon}</span>
      {children}
    </button>
  );
}
