import Link from "next/link";
import Image from "next/image";
import { Trophy, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { initialsFor } from "@/lib/display-name";
import type { FollowListPerson } from "@/lib/geo/people";

/**
 * A followers / following list. One component for both directions — they differ
 * only in copy, and two components would drift.
 *
 * Server-rendered: these are public pages that want to be crawlable and want to
 * paint without a fetch. There is no follow button on the rows deliberately —
 * following from a list of followers is a different intent from browsing them, and
 * the row already links to the profile where the button lives.
 */
export function FollowList({
  people,
  direction,
  ownerName,
}: {
  people: FollowListPerson[];
  direction: "followers" | "following";
  ownerName: string;
}) {
  if (people.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Users className="size-5" />}
        title={direction === "followers" ? "No followers yet" : "Not following anyone yet"}
        body={
          direction === "followers"
            ? `Nobody is following ${ownerName} yet. Predictions and a public record are what earn them.`
            : `${ownerName} isn't following anyone yet.`
        }
        action={{ href: "/leaderboard", label: "Browse predictors" }}
      />
    );
  }

  return (
    <ul className="divide-y divide-ink-800 overflow-hidden card-surface">
      {people.map((p) => (
        <li key={p.username}>
          <Link
            href={`/u/${p.username}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            <span className="size-10 shrink-0 overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
              {p.image ? (
                <Image src={p.image} alt="" width={80} height={80} className="size-full object-cover" unoptimized />
              ) : (
                <span className="flex size-full items-center justify-center font-display text-sm font-bold text-mist">
                  {initialsFor(p)}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display font-semibold text-chalk">{p.name}</span>
              <span className="block truncate text-xs text-fog">@{p.username}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm tabular-nums text-mist">
              <Trophy aria-hidden className="size-3.5 text-gold-400" />
              {p.reputation.toLocaleString()}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
