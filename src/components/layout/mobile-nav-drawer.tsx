"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, User } from "lucide-react";
import { SITE, type NavItem } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";

type DrawerUser = { name?: string | null; username?: string | null } | null;

const EDGE = 28;        // px from the left edge where an open-swipe can begin
const OPEN_AT = 0.4;    // fraction of width dragged past which we snap open
const VELOCITY = 0.35;  // px/ms fling threshold that overrides the position snap

// Left navigation drawer with an edge "puller" handle and finger-following
// swipe gestures. Swipe right from the left edge (or tap the puller / hamburger)
// to open; swipe left / tap the scrim to close. Mobile only (lg:hidden) — the
// desktop nav is the horizontal bar in <Navbar>.
export function MobileNavDrawer({
  open, onOpenChange, items, pathname, t, user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: NavItem[];
  pathname: string;
  t: (s: string) => string;
  user: DrawerUser;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const width = useRef(320);
  const [dragX, setDragX] = useState<number | null>(null); // px offset [-width, 0] while dragging, else null
  const dragXRef = useRef<number | null>(null); // mirror for the once-bound touchend handler
  const gesture = useRef<{ active: boolean; mode: "open" | "close" | null; startX: number; startY: number; lastX: number; lastT: number; vx: number; decided: boolean }>(
    { active: false, mode: null, startX: 0, startY: 0, lastX: 0, lastT: 0, vx: 0, decided: false },
  );

  const measure = useCallback(() => {
    width.current = panelRef.current?.offsetWidth || Math.min(264, Math.round(window.innerWidth * 0.68));
  }, []);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on route change.
  useEffect(() => { onOpenChange(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pathname]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Don't hijack touches while a full-screen overlay/modal owns the screen
      // (reels, dialogs set body overflow:hidden). When our own drawer is open,
      // body is also hidden — but we still want to allow close-drags, so only
      // block open-drags in that case.
      const bodyLocked = document.body.style.overflow === "hidden";
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const g = gesture.current;
      g.startX = x; g.startY = y; g.lastX = x; g.lastT = e.timeStamp; g.vx = 0; g.decided = false; g.active = false; g.mode = null;
      if (open) {
        g.active = true; g.mode = "close";
      } else if (!bodyLocked && x <= EDGE) {
        g.active = true; g.mode = "open"; measure();
      }
    };

    const onMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (!g.active) return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const dx = x - g.startX, dy = y - g.startY;
      g.vx = (x - g.lastX) / Math.max(1, e.timeStamp - g.lastT);
      g.lastX = x; g.lastT = e.timeStamp;

      if (!g.decided) {
        // Only commit to a horizontal drag once it clearly beats vertical motion.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) { g.active = false; return; } // vertical scroll — let it be
        g.decided = true;
      }
      const w = width.current;
      const offset = g.mode === "open"
        ? Math.max(-w, Math.min(0, -w + dx))   // starts at -w, opens toward 0
        : Math.max(-w, Math.min(0, dx));        // starts at 0, closes toward -w
      setDragX(offset);
      if (e.cancelable) e.preventDefault(); // stop the page scrolling under a horizontal drag
    };

    const onEnd = () => {
      const g = gesture.current;
      if (!g.active || !g.decided) { g.active = false; setDragX(null); return; }
      g.active = false;
      const w = width.current;
      const offset = dragXRef.current ?? (g.mode === "open" ? -w : 0);
      const opened = g.vx > VELOCITY || (g.vx > -VELOCITY && offset > -w * (1 - OPEN_AT));
      setDragX(null);
      onOpenChange(opened);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep a ref of dragX for the touchend handler (which is bound once).
  useEffect(() => { dragXRef.current = dragX; }, [dragX]);

  const dragging = dragX !== null;
  const w = width.current;
  // While dragging use measured px; when settled use -101% so the panel fully
  // clears the screen regardless of its exact rendered width.
  const transform = dragging ? `translate3d(${dragX}px,0,0)` : open ? "translate3d(0,0,0)" : "translate3d(-101%,0,0)";
  const progress = dragging ? Math.max(0, 1 + dragX! / w) : open ? 1 : 0; // 0 closed → 1 open, for scrim opacity

  return (
    <div className="lg:hidden">
      {/* Edge puller — always visible on mobile, invites the swipe. Hidden while open. */}
      <button
        aria-label="Open menu"
        onClick={() => onOpenChange(true)}
        className={cn(
          "cr-nav-puller fixed left-0 top-1/2 z-[45] flex h-16 w-6 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-ink-700 bg-ink-900/90 text-blood-400 shadow-lg shadow-black/40 backdrop-blur-md transition-opacity duration-200",
          open ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <span className="flex flex-col gap-0.5">
          <span className="h-4 w-0.5 rounded-full bg-current opacity-80" />
        </span>
        <ChevronRight className="absolute size-3.5 translate-x-[3px] opacity-70" />
      </button>

      {/* Scrim — above the sticky navbar header (z-50) so the drawer covers the
          whole screen; otherwise the translucent header shows the page at top. */}
      <div
        onClick={() => onOpenChange(false)}
        className={cn("fixed inset-0 z-[60]", (open || dragging) ? "pointer-events-auto" : "pointer-events-none")}
        style={{ backgroundColor: `rgba(5,7,10,${(0.72 * progress).toFixed(3)})`, transition: dragging ? "none" : "background-color 300ms" }}
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        className="fixed left-0 top-0 z-[61] flex h-[100dvh] w-[68%] max-w-[264px] flex-col border-r border-ink-700 bg-ink-900 will-change-transform"
        style={{ transform, transition: dragging ? "none" : "transform 300ms cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <Logo href="/" sizeClass="h-9" />
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="grid gap-1">
            {items.map((item) =>
              item.children ? (
                <DrawerGroup key={item.href} item={item} pathname={pathname} t={t} onNavigate={() => onOpenChange(false)} />
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => onOpenChange(false)}
                  className={cn(
                    "flex items-center justify-between rounded-xl px-4 py-3.5 font-display text-base font-semibold uppercase tracking-wide transition-colors",
                    isActive(pathname, item.href) ? "bg-blood-500/15 text-blood-300" : "text-chalk hover:bg-ink-800",
                  )}
                >
                  {t(item.label)}
                  <ChevronRight className="size-4 text-fog" />
                </Link>
              ),
            )}
          </div>
        </nav>

        <div className="border-t border-ink-800 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Link
            href="/account"
            onClick={() => onOpenChange(false)}
            className="flex items-center justify-center gap-2 rounded-xl bg-blood-500 px-4 py-3.5 font-display font-semibold uppercase text-white hover:bg-blood-400"
          >
            <User className="size-4" /> {user ? (user.username ?? user.name ?? t("Your Account")) : t("Sign in")}
          </Link>
          <p className="mt-3 text-center text-xs text-fog">{SITE.tagline}</p>
        </div>
      </aside>
    </div>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function DrawerGroup({
  item, pathname, t, onNavigate,
}: {
  item: NavItem; pathname: string; t: (s: string) => string; onNavigate: () => void;
}) {
  const active = item.children?.some((c) => isActive(pathname, c.href)) ?? false;
  const [open, setOpen] = useState(active);
  const accent = !!item.accent;
  return (
    <div className={cn(accent && "mt-1")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between rounded-xl px-4 py-3.5 font-display text-base font-semibold uppercase tracking-wide transition-colors",
          accent
            ? cn("border", active || open ? "border-blood-500 bg-blood-500 text-white" : "border-blood-500/40 bg-blood-500/10 text-blood-300")
            : active ? "bg-blood-500/15 text-blood-300" : "text-chalk hover:bg-ink-800",
        )}
      >
        {t(item.label)}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180", accent ? "" : "text-fog")} />
      </button>
      {open && (
        <div className="mt-1 grid gap-1 border-l border-ink-700 pl-3">
          {item.children!.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center justify-between rounded-lg px-4 py-3 font-display text-sm font-semibold uppercase tracking-wide transition-colors",
                isActive(pathname, c.href) ? "bg-blood-500/15 text-blood-300" : "text-mist hover:bg-ink-800 hover:text-chalk",
              )}
            >
              {t(c.label)}
              <ChevronRight className="size-4 text-fog" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
