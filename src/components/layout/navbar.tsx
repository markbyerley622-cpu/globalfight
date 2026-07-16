"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Menu, X, User, ChevronDown } from "lucide-react";
import { PRIMARY_NAV, type NavItem } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-client";
import { Logo } from "@/components/logo";
import { SearchOverlay } from "@/components/search/search-overlay";
import { MobileNavDrawer } from "./mobile-nav-drawer";
import { LanguageSwitcher } from "./language-switcher";

export function Navbar() {
  const pathname = usePathname();
  const t = useT();
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 w-full border-b transition-all duration-300",
          scrolled
            ? "border-ink-700 bg-ink-950/90 backdrop-blur-xl"
            : "border-transparent bg-gradient-to-b from-ink-950 to-transparent",
        )}
      >
        <div className="container-cr flex h-[4.5rem] items-center gap-4 lg:h-20">
          {/* Logo */}
          <Logo className="shrink-0" sizeClass="h-11 sm:h-12 lg:h-14" priority />

          {/* Desktop nav */}
          <nav className="hidden flex-1 items-center justify-center gap-0.5 lg:flex">
            {PRIMARY_NAV.map((item) =>
              item.children ? (
                <DesktopDropdown key={item.href} item={item} pathname={pathname} t={t} />
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative rounded-md px-3 py-2 font-display text-[0.82rem] font-semibold uppercase tracking-wide transition-colors",
                    isActive(pathname, item.href) ? "text-chalk" : "text-mist hover:text-chalk",
                  )}
                >
                  {t(item.label)}
                  {isActive(pathname, item.href) && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-blood-500" />}
                </Link>
              ),
            )}
          </nav>

          {/* Right actions */}
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850/60 px-2.5 py-2 text-sm text-mist transition-colors hover:border-ink-600 hover:text-chalk"
              aria-label="Search"
            >
              <Search className="size-4" />
              <span className="hidden text-xs xl:inline">{t("Search")}</span>
              <kbd className="hidden rounded border border-ink-600 px-1 text-[0.6rem] xl:inline">⌘K</kbd>
            </button>

            <LanguageSwitcher />

            {user ? (
              <Link
                href="/account"
                className="hidden items-center gap-2 rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2 font-display text-xs font-semibold uppercase text-chalk transition-colors hover:border-ink-600 sm:flex"
                title={user.email ?? undefined}
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-blood-500/20 text-[0.6rem] text-blood-300">
                  {(user.name ?? user.username ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[8rem] truncate">{user.username ?? user.name}</span>
              </Link>
            ) : (
              <Link
                href="/account"
                className="hidden items-center gap-2 rounded-lg bg-blood-500 px-3.5 py-2 font-display text-xs font-semibold uppercase text-white transition-colors hover:bg-blood-400 sm:flex"
              >
                <User className="size-4" /> {t("Sign in")}
              </Link>
            )}

            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="rounded-lg p-2 text-chalk lg:hidden"
              aria-label="Menu"
            >
              {mobileOpen ? <X className="size-6" /> : <Menu className="size-6" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile: swipeable left drawer with an edge puller (see MobileNavDrawer). */}
      <MobileNavDrawer
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        items={PRIMARY_NAV}
        pathname={pathname}
        t={t}
        user={user}
      />

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function groupActive(pathname: string, item: NavItem) {
  return item.children?.some((c) => isActive(pathname, c.href)) ?? false;
}

/** Desktop hover/click dropdown for a grouped nav item. */
function DesktopDropdown({
  item, pathname, t,
}: {
  item: NavItem;
  pathname: string;
  t: (s: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = groupActive(pathname, item);
  const accent = !!item.accent;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Collapse when navigating to a new route.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div
      ref={ref}
      className={cn("relative", accent && "ml-1")}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "relative flex items-center gap-1 font-display text-[0.82rem] font-semibold uppercase tracking-wide transition-colors",
          accent
            ? cn(
                "rounded-full border px-4 py-2",
                active || open
                  ? "border-blood-500 bg-blood-500 text-white"
                  : "border-blood-500/50 bg-blood-500/10 text-blood-300 hover:bg-blood-500/20 hover:text-blood-200",
              )
            : cn(
                "rounded-md px-3 py-2",
                active || open ? "text-chalk" : "text-mist hover:text-chalk",
              ),
        )}
      >
        {t(item.label)}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {!accent && active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-blood-500" />}
      </button>
      <div
        className={cn(
          "absolute left-1/2 top-full z-50 w-56 -translate-x-1/2 pt-2 transition-all duration-150",
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0",
        )}
      >
        <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900 p-1.5 shadow-2xl shadow-black/40">
          {item.children!.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={cn(
                "block rounded-lg px-3 py-2.5 font-display text-[0.8rem] font-semibold uppercase tracking-wide transition-colors",
                isActive(pathname, c.href) ? "bg-blood-500/15 text-blood-300" : "text-mist hover:bg-ink-800 hover:text-chalk",
              )}
            >
              {t(c.label)}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

