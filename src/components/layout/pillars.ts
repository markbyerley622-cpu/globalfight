import { CalendarDays, BarChart3, Users, MapPin, User } from "lucide-react";

/**
 * The five product pillars — the ONE definition.
 *
 * Read by the mobile bottom bar and the desktop header nav. Two copies would
 * drift the moment a matcher changed, and the symptom would be a tab that
 * highlights on a phone and not on a laptop.
 */
export const PILLARS: {
  href: string;
  label: string;
  icon: typeof User;
  match: (p: string) => boolean;
}[] = [
  {
    href: "/events",
    label: "Events",
    icon: CalendarDays,
    // A fight belongs to an event — keep Events lit on a bout page so the core
    // predict/discuss surface never loses its home tab.
    match: (p) =>
      p.startsWith("/events") || p.startsWith("/schedule") || p.startsWith("/results") || p.startsWith("/fights"),
  },
  {
    href: "/leaderboard",
    label: "Leaderboard",
    icon: BarChart3,
    // Fighter profiles are ranked entities reached from the board — keep the
    // Leaderboard pillar lit there so a detail page never loses its home tab.
    match: (p) =>
      p.startsWith("/leaderboard") || p.startsWith("/rankings") || p.startsWith("/p4p") ||
      p.startsWith("/champions") || p.startsWith("/fighters"),
  },
  { href: "/following", label: "Following", icon: Users, match: (p) => p.startsWith("/following") },
  // Gyms live under Location: they are the places the map points at.
  { href: "/map", label: "Location", icon: MapPin, match: (p) => p.startsWith("/map") || p.startsWith("/gyms") },
  {
    href: "/profile",
    label: "Profile",
    icon: User,
    // "My Predictions" is your personal record, reached from the profile — it
    // lives under Profile, not the gated /predictions markets route. /today is
    // the same identity pillar seen day-by-day rather than all-time.
    match: (p) =>
      p.startsWith("/profile") || p.startsWith("/account") || p.startsWith("/u/") ||
      p.startsWith("/predictions/mine") || p.startsWith("/today"),
  },
];
