"use client";

import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// Public registry-role label shown next to a user's name (forum posts,
// comments, profiles). `sport` is appended for fighters once known, e.g.
// "Fighter • MMA".
const ROLE_LABEL: Record<string, string> = {
  fan: "Fan",
  fighter: "Fighter",
  world_champion: "World Champion",
  coach: "Coach",
  gym: "Gym",
  promoter: "Promoter",
  manager: "Manager",
  official: "Official",
  media: "Media",
  ring_girl: "Ring Girl",
  medic: "Medic",
};

// Each registry role gets its own distinct colour so a user's type reads at a
// glance next to their name (forum threads/posts, profiles).
const ROLE_TONE: Record<string, string> = {
  fan: "bg-slate-500/20 text-slate-300",
  fighter: "bg-blood-500/15 text-blood-300",
  world_champion: "bg-gold-500/20 text-gold-200 ring-1 ring-gold-500/40",
  coach: "bg-emerald-500/15 text-emerald-300",
  gym: "bg-orange-500/15 text-orange-300",
  promoter: "bg-gold-500/15 text-gold-300",
  manager: "bg-indigo-500/20 text-indigo-300",
  official: "bg-sky-500/15 text-sky-300",
  media: "bg-teal-500/15 text-teal-300",
  ring_girl: "bg-pink-500/15 text-pink-300",
  medic: "bg-lime-500/15 text-lime-300",
};

// Roles that wear a crown — the elite tiers.
const CROWNED = new Set(["world_champion"]);

export function RoleBadge({ role, sport, className }: { role: string; sport?: string; className?: string }) {
  const t = useT();
  const label = ROLE_LABEL[role] ?? "Fan";
  const tone = ROLE_TONE[role] ?? "bg-ink-700/60 text-mist";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider", tone, className)}>
      {CROWNED.has(role) && <Crown className="size-2.5 fill-current" />}
      {t(label)}{sport ? ` • ${sport}` : ""}
    </span>
  );
}

/** Staff crown — shown for ADMIN / MODERATOR accounts next to their name. */
export function AdminBadge({ role = "ADMIN", className }: { role?: string; className?: string }) {
  const t = useT();
  const label = role === "MODERATOR" ? "Mod" : "Admin";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider bg-gold-500/25 text-gold-100 ring-1 ring-gold-400/50", className)}>
      <Crown className="size-2.5 fill-current" />
      {t(label)}
    </span>
  );
}
