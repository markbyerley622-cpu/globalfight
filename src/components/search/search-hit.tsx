"use client";

import Link from "next/link";
import Image from "next/image";
import { PresenceDot } from "@/components/presence/presence-dot";
import type { PresenceDto } from "@/lib/presence/policy";
import { BadgeCheck } from "lucide-react";
import { FollowButton, type FollowKind } from "@/components/follow-button";

// ════════════════════════════════════════════════════════════════════════════
//  A search result you can act on without leaving search.
//
//  Every followable entity renders through this ONE row: avatar, verification
//  badge, name, meta, follower count and the same FollowButton the profile pages
//  use — which is what makes the optimistic state, the cross-tab sync and the
//  signed-out redirect identical here and everywhere else. A search-specific follow
//  control would have been a second implementation of all three.
// ════════════════════════════════════════════════════════════════════════════

export interface SearchFollowMaps {
  following: {
    fighters: Record<string, boolean>;
    events: Record<string, boolean>;
    gyms: Record<string, boolean>;
    promotions: Record<string, boolean>;
    people: Record<string, boolean>;
  };
  followers: {
    fighters: Record<string, number>;
    gyms: Record<string, number>;
    promotions: Record<string, number>;
    people: Record<string, number>;
  };
}

/** Compact follower count. A count of zero is hidden rather than shown as "0". */
export function followerLabel(n: number | undefined): string | null {
  if (!n) return null;
  if (n < 1000) return `${n} follower${n === 1 ? "" : "s"}`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k followers`;
}

export function SearchHit({
  href,
  kind,
  slug,
  name,
  meta,
  image,
  presence,
  fallbackIcon,
  verified,
  following,
  followers,
  onNavigate,
}: {
  href: string;
  /** Omit to render a row with no follow control (news, forums, pages). */
  kind?: FollowKind;
  /** The identifier the follow endpoint takes — a slug, or a username for a person. */
  slug?: string;
  name: React.ReactNode;
  meta?: React.ReactNode;
  image?: string | null;
  /** People rows only. Absent on gyms, events and fighters — see the audit. */
  presence?: PresenceDto | null;
  fallbackIcon: React.ReactNode;
  verified?: boolean;
  following?: boolean;
  followers?: number | null;
  onNavigate?: () => void;
}) {
  const count = followerLabel(followers ?? undefined);

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-ink-700/70">
      <Link
        href={href}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
      >
        <span className="relative size-9 shrink-0">
          <span className="grid size-full place-items-center overflow-hidden rounded-lg border border-ink-700 bg-ink-850 text-mist">
            {image ? (
              // 72px source for a 36px box — crisp on a 2× screen without paying for
              // a full-size portrait in a list of six.
              <Image src={image} alt="" width={72} height={72} className="size-full object-cover" unoptimized />
            ) : (
              fallbackIcon
            )}
          </span>
          {/* Only when the caller supplied one, and only positive presence:
              search results are scanned, not studied, and a grey dot on every
              row is noise that hides the green one. */}
          {presence !== undefined && (
            <PresenceDot presence={presence} size="sm" showOffline={false} ringClassName="border-ink-900" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate font-display font-semibold text-chalk">
            <span className="truncate">{name}</span>
            {verified && (
              <BadgeCheck aria-label="Verified" className="size-3.5 shrink-0 text-volt-400" />
            )}
          </span>
          {(meta || count) && (
            <span className="block truncate text-xs text-fog">
              {meta}
              {meta && count ? " · " : ""}
              {count}
            </span>
          )}
        </span>
      </Link>

      {kind && slug && (
        // size="sm" and shrink-0: the button must never squeeze the name out of a
        // narrow row, and it must stay a 44px touch target (FollowButton enforces
        // the height itself).
        <FollowButton
          kind={kind}
          slug={slug}
          initialFollowing={!!following}
          size="sm"
          name={typeof name === "string" ? name : undefined}
          className="shrink-0"
        />
      )}
    </div>
  );
}
