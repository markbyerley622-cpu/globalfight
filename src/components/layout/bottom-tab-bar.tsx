"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays, Heart, Users, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

/**
 * Five bottom buttons: Home · Events · Following · Community · Profile.
 * Home owns the sport-filtered feed of news + events; Events is the
 * event-centric core (schedule/results folded in); Following is the return leg
 * (everything from what you follow); Community carries forums and the respect /
 * middle-finger reactions.
 */
const HOME_MATCH = (p: string) => p === "/";
const EVENTS_MATCH = (p: string) =>
  p.startsWith("/events") || p.startsWith("/schedule") || p.startsWith("/results");
const FOLLOWING_MATCH = (p: string) => p.startsWith("/following");
const COMMUNITY_MATCH = (p: string) =>
  p.startsWith("/community") || p.startsWith("/forums");
const PROFILE_MATCH = (p: string) => p.startsWith("/profile") || p.startsWith("/account");

export function BottomTabBar({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useT();

  const item = (href: string, label: string, Icon: typeof Home, active: boolean) => (
    <Link
      href={href}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 py-1 transition-colors",
        active ? "text-chalk" : "text-fog hover:text-mist",
      )}
    >
      <Icon className={cn("size-6", active && "text-blood-500")} strokeWidth={2} />
      <span className="text-[0.6rem] font-bold uppercase tracking-wide">{t(label)}</span>
    </Link>
  );

  return (
    <nav
      className={cn(
        "flex shrink-0 items-end justify-around border-t border-ink-800 bg-ink-950/80 px-6 pt-2 backdrop-blur-xl",
        "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {item("/", "Home", Home, HOME_MATCH(pathname))}
      {item("/events", "Events", CalendarDays, EVENTS_MATCH(pathname))}
      {item("/following", "Following", Heart, FOLLOWING_MATCH(pathname))}
      {item("/community", "Community", Users, COMMUNITY_MATCH(pathname))}
      {item("/profile", "Profile", User, PROFILE_MATCH(pathname))}
    </nav>
  );
}
