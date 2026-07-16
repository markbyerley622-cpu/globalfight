"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Settings, Bookmark, TrendingUp, LogOut, CircleUserRound, Menu, Home, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-client";
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
  const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-xl border-2 border-blood-500 bg-ink-950 font-display text-xs font-bold text-blood-500 shadow-[0_0_12px_-3px_rgba(225,29,42,0.55)] transition-transform active:scale-95"
      >
        {initial ?? <User className="size-4" />}
      </button>

      {open && (
        <div
          role="menu"
          className="rise absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.85)]"
        >
          {/* Identity */}
          <div className="flex items-center gap-3 border-b border-ink-800 bg-ink-850 p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-blood-500 bg-ink-950 font-display text-sm font-bold text-blood-500">
              {initial ?? <User className="size-4" />}
            </span>
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-bold text-chalk">
                {user ? user.username ?? user.name ?? "Fan" : "Guest fan"}
              </div>
              <div className="truncate text-[0.7rem] text-mist">{user ? user.email : "Not signed in"}</div>
            </div>
          </div>

          <nav className="p-1.5">
            <Item href="/" icon={<Home className="size-4" />} onClick={() => setOpen(false)}>Home</Item>
            {user ? (
              <>
                <Item href="/profile" icon={<CircleUserRound className="size-4" />} onClick={() => setOpen(false)}>Profile</Item>
                <Item href="/predictions" icon={<TrendingUp className="size-4" />} onClick={() => setOpen(false)}>My Predictions</Item>
                <Item href="/library" icon={<Bookmark className="size-4" />} onClick={() => setOpen(false)}>Saved</Item>
                <Item href="/account" icon={<Settings className="size-4" />} onClick={() => setOpen(false)}>Settings</Item>
                {isAdmin && (
                  <Item href="/admin/claims" icon={<ShieldCheck className="size-4" />} onClick={() => setOpen(false)}>Verification</Item>
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
