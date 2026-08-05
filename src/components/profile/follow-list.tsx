import Link from "next/link";
import Image from "next/image";
import { Trophy, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { FollowButton } from "@/components/follow-button";
import { initialsFor } from "@/lib/display-name";
import type { FollowListPerson } from "@/lib/geo/people";

/**
 * A followers / following list. One component for both directions — they differ
 * only in copy, and two components would drift.
 *
 * Server-rendered: these are public pages that want to be crawlable and want to
 * paint without a fetch.
 *
 * ── The follow button on each row ──────────────────────────────────────────
 * This used to carry a comment arguing the rows should NOT have one: that
 * "following from a list of followers is a different intent from browsing them",
 * and the row already links to the profile where the button lives.
 *
 * That is the wrong way round. Someone's followers list is the densest page of
 * people-you-might-follow in the product — it is a discovery surface, not a
 * directory — and the design routed every one of those decisions through a
 * profile page and a Back button. The control belongs wherever a person appears.
 * It is the SAME FollowButton the profile, search and the map pins use, so a
 * follow taken here behaves identically (optimistic, cross-tab synced,
 * router.refresh to re-derive the counts above) to one taken anywhere else.
 *
 * `following` is a batched map supplied by the page (searchFollowState) rather
 * than a per-row query — forty rows must not be forty round-trips. An absent key
 * reads as "not following", which is also the correct render for a signed-out
 * visitor: the button sends them to /account when tapped.
 */
export function FollowList({
  people,
  direction,
  ownerName,
  following = {},
  viewerUsername = null,
}: {
  people: FollowListPerson[];
  direction: "followers" | "following";
  ownerName: string;
  /** username → the viewer already follows them. Batched by the page. */
  following?: Record<string, boolean>;
  /** The viewer's own handle — their row gets no button. Self-follow is refused
   *  by the API, so a control there is a guaranteed dead end. */
  viewerUsername?: string | null;
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
        // The Link no longer wraps the whole row: a <button> inside an <a> is
        // invalid HTML, and in practice a tap that tries to do both things.
        // The link covers the identity (avatar · name · reputation); the follow
        // control is its sibling.
        <li key={p.username} className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-ink-800">
          <Link
            href={`/u/${p.username}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
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

          {p.username !== viewerUsername && (
            <FollowButton
              kind="person"
              slug={p.username}
              name={p.name}
              initialFollowing={following[p.username] ?? false}
              size="sm"
              className="shrink-0"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
