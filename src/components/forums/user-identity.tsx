"use client";

import Image from "next/image";
import Link from "next/link";
import { RoleBadge, AdminBadge } from "@/components/role-badge";
import { PresenceDot } from "@/components/presence/presence-dot";
import type { PresenceDto } from "@/lib/presence/policy";
import { SPORT_LABEL } from "@/lib/sports";
import { cn } from "@/lib/utils";

// Deterministic identity colour from a name (matches the fighter-avatar feel).
function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase() || "?";
}

const SIZE = {
  sm: "size-8 text-2xs",
  md: "size-9 text-sm",
  lg: "size-11 text-base",
} as const;

/**
 * Profile photo (when set) or a deterministic monogram. Phase 5 identity.
 *
 * ── Presence is a PROP here, deliberately ─────────────────────────────────
 * This is the avatar nearly every surface already renders, so making it accept
 * a `presence` DTO means a new surface gets the indicator by passing one prop
 * — no wrapper to remember, no second dot implementation, and no chance of the
 * dot ending up anchored to the page instead of the face.
 *
 * Optional, and absent means simply no dot. Surfaces where presence is noise
 * (a three-month-old post's author) pass nothing and are unchanged.
 *
 * Note the overflow change: the ring on the dot has to sit OUTSIDE the circular
 * clip, so the clipping moved onto an inner element rather than this box.
 */
export function ForumAvatar({
  name, image, size = "md", className, presence, showOffline = true,
}: {
  name: string; image?: string | null; size?: keyof typeof SIZE; className?: string;
  /** Already filtered for the viewer by presenceDtoFor. */
  presence?: PresenceDto | null;
  /** Dense lists pass false so they do not become a wall of grey circles. */
  showOffline?: boolean;
}) {
  const hue = hueFromName(name || "Member");
  // `relative` is load-bearing: <Image fill> positions against the nearest
  // POSITIONED ancestor. Without it the image resolved against the outer box
  // and escaped this element's circular clip entirely — avatars rendered as
  // squares wherever a photo was set.
  const face = (
    <div className="relative size-full overflow-hidden rounded-full">
      {image ? (
        <Image src={image} alt={name} fill className="object-cover" sizes="44px" />
      ) : (
        <span
          className="flex size-full items-center justify-center font-display font-bold text-white"
          style={{ background: `radial-gradient(125% 125% at 30% 20%, hsl(${hue} 62% 48%), hsl(${(hue + 35) % 360} 70% 20%))` }}
        >
          {initials(name)}
        </span>
      )}
    </div>
  );

  return (
    <div className={cn("relative shrink-0 rounded-full", SIZE[size], className)}>
      {face}
      {presence !== undefined && (
        <PresenceDot
          presence={presence}
          size={size === "sm" ? "sm" : "md"}
          showOffline={showOffline}
        />
      )}
    </div>
  );
}

/**
 * One-line author identity: photo + name + role badge (with sport for fighters).
 * Used in thread cards, posts and the feed so "who people are" reads instantly.
 */
export function AuthorIdentity({
  name, image, role, appRole, sport, size = "md", subline, op, username, className,
  presence, showOffline = true,
}: {
  name: string; image?: string | null; role: string; appRole?: string; sport?: string | null;
  size?: keyof typeof SIZE; subline?: React.ReactNode; op?: boolean; username?: string | null; className?: string;
  /** Passed straight through to the avatar. Omit where presence is noise. */
  presence?: PresenceDto | null;
  showOffline?: boolean;
}) {
  const sportLabel = role === "fighter" && sport ? SPORT_LABEL[sport] ?? sport : undefined;
  const isStaff = appRole === "ADMIN" || appRole === "MODERATOR";
  // When we know the author's handle, the avatar + name link to their public
  // profile — so respect (rep, streak, accuracy) is one tap away from any post.
  const inner = (
    <ForumAvatar
      name={name} image={image} size={size}
      presence={presence} showOffline={showOffline}
    />
  );
  const avatar = username
    ? <Link href={`/u/${username}`} className="transition-opacity hover:opacity-80">{inner}</Link>
    : inner;
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {avatar}
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 font-display text-sm font-bold leading-tight text-chalk">
          {username
            ? <Link href={`/u/${username}`} className="truncate hover:text-blood-300 hover:underline">{name}</Link>
            : <span className="truncate">{name}</span>}
          {isStaff && <AdminBadge role={appRole} />}
          <RoleBadge role={role} sport={sportLabel} />
          {op && <span className="rounded bg-blood-500/15 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider text-blood-300">OP</span>}
        </p>
        {subline && <p className="truncate text-xs text-fog">{subline}</p>}
      </div>
    </div>
  );
}
