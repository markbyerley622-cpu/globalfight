"use client";

import Image from "next/image";
import Link from "next/link";
import { RoleBadge, AdminBadge } from "@/components/role-badge";
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
  sm: "size-8 text-[0.7rem]",
  md: "size-9 text-sm",
  lg: "size-11 text-base",
} as const;

/** Profile photo (when set) or a deterministic monogram. Phase 5 identity. */
export function ForumAvatar({
  name, image, size = "md", className,
}: {
  name: string; image?: string | null; size?: keyof typeof SIZE; className?: string;
}) {
  const hue = hueFromName(name || "Member");
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-full", SIZE[size], className)}>
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
}

/**
 * One-line author identity: photo + name + role badge (with sport for fighters).
 * Used in thread cards, posts and the feed so "who people are" reads instantly.
 */
export function AuthorIdentity({
  name, image, role, appRole, sport, size = "md", subline, op, username, className,
}: {
  name: string; image?: string | null; role: string; appRole?: string; sport?: string | null;
  size?: keyof typeof SIZE; subline?: React.ReactNode; op?: boolean; username?: string | null; className?: string;
}) {
  const sportLabel = role === "fighter" && sport ? SPORT_LABEL[sport] ?? sport : undefined;
  const isStaff = appRole === "ADMIN" || appRole === "MODERATOR";
  // When we know the author's handle, the avatar + name link to their public
  // profile — so respect (rep, streak, accuracy) is one tap away from any post.
  const avatar = username
    ? <Link href={`/u/${username}`} className="transition-opacity hover:opacity-80"><ForumAvatar name={name} image={image} size={size} /></Link>
    : <ForumAvatar name={name} image={image} size={size} />;
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
          {op && <span className="rounded bg-blood-500/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-blood-300">OP</span>}
        </p>
        {subline && <p className="truncate text-xs text-fog">{subline}</p>}
      </div>
    </div>
  );
}
