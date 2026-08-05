import Link from "next/link";
import { Swords, Lock, Users, ArrowRight, Target } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PromotionLogo } from "@/components/promotion-logo";
import { Countdown } from "@/components/countdown";
import { formatDate } from "@/lib/utils";
import { viewAllHref } from "@/lib/profile/profile-service";
import type { CurrentPick } from "@/lib/profile/types";
import { ProfileSection } from "./profile-section";

/**
 * CURRENT PICKS — the hero content of a profile.
 *
 * This is the answer to "what is this person calling right now?", which is the
 * first of the three questions a profile has five seconds to answer, and the
 * only one that makes a profile worth revisiting rather than reading once.
 *
 * ── Why these cards are not the BoutPick card ────────────────────────────
 * The compact prediction control is an INPUT: two lock buttons, a crowd bar and
 * a finish chooser, all of which write. On someone else's profile every one of
 * those is wrong — you cannot pick a fight on their behalf — and on your own it
 * would be a second place to change a call that already has one. So this is a
 * read-only summary that reuses the same VOCABULARY (corner colour, crowd
 * percentage, promotion mark, countdown) and links to the bout, where the real
 * control lives. Nothing about predictions is reimplemented: every field comes
 * resolved from the profile service.
 */
export function CurrentPicks({ picks, more, isSelf }: {
  picks: CurrentPick[];
  more: boolean;
  /** Copy differs: "your" next calls vs "their" next calls. */
  isSelf: boolean;
}) {
  if (picks.length === 0) {
    return (
      <ProfileSection title="Current picks" icon={<Target className="size-4" />}>
        <EmptyState
          compact
          icon={<Swords className="size-5 text-blood-400" />}
          title="No active picks."
          body={
            isSelf
              ? "Call a fight and it shows up here until the bell — with the room's split and a live countdown."
              : "Nothing called on an upcoming fight right now."
          }
          action={isSelf ? { href: "/events", label: "Browse upcoming events" } : undefined}
          // `secondary` is a ReactNode slot, not an action object — it is the
          // "how do I fill this?" row, so it renders as a link rather than a
          // second button competing with the primary CTA.
          secondary={
            isSelf ? (
              <Link href="/predictions" className="text-2xs font-semibold text-fog underline underline-offset-2 hover:text-chalk">
                Find fights to predict
              </Link>
            ) : undefined
          }
        />
      </ProfileSection>
    );
  }

  return (
    <ProfileSection
      title="Current picks"
      icon={<Target className="size-4" />}
      count={picks.length}
      viewAll={more ? { href: viewAllHref("active"), label: "View all" } : undefined}
      isSelf={isSelf}
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {picks.map((p) => <PickCard key={p.fightSlug} pick={p} />)}
      </ul>
    </ProfileSection>
  );
}

function PickCard({ pick: p }: { pick: CurrentPick }) {
  const red = p.corner === "RED";
  const href = p.eventSlug ? `/events/${p.eventSlug}#fight-${p.fightSlug}` : `/fights/${p.fightSlug}`;

  return (
    <li>
      <Link
        href={href}
        className="group flex h-full flex-col gap-2.5 rounded-card border border-ink-800 bg-ink-900/60 p-3.5 transition-all hover:-translate-y-0.5 hover:border-blood-500/40 hover:bg-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
      >
        {/* Promotion + event — the context that makes a fighter name mean
            something to someone who does not follow that division. */}
        <div className="flex items-center gap-2 text-2xs text-fog">
          {p.promotion && <PromotionLogo promotion={p.promotion} size="sm" />}
          <span className="min-w-0 flex-1 truncate">{p.eventName ?? "Upcoming bout"}</span>
          {p.picksClosed && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-700 bg-ink-800 px-1.5 py-0.5 font-bold uppercase tracking-wide text-mist"
              // Not colour alone: the word "Locked" carries it for anyone who
              // cannot separate the grey chip from the rest of the row.
            >
              <Lock className="size-2.5" aria-hidden /> Locked
            </span>
          )}
        </div>

        {/* The matchup, with the CALLED fighter carrying the corner colour and
            the weight. A reader scanning six cards should be able to see who
            this person is backing without reading both names. */}
        <p className="font-display text-sm leading-tight">
          <span className={red ? "font-black text-blood-300" : "text-fog"}>{p.redName}</span>
          <span className="px-1.5 text-3xs font-bold uppercase text-fog">vs</span>
          <span className={red ? "text-fog" : "font-black text-volt-300"}>{p.blueName}</span>
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xs">
          {/* The call, spelled out. */}
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-bold ${
              red ? "border-blood-500/40 bg-blood-500/15 text-blood-200" : "border-volt-500/40 bg-volt-500/15 text-volt-200"
            }`}
          >
            <Swords className="size-2.5" aria-hidden />
            {p.pickedName}
            {p.finish && <span className="font-normal opacity-80">· {p.finish}</span>}
          </span>

          {/* How much of the room agrees — the social proof that turns a pick
              into an opinion worth arguing with. */}
          {p.crowdWithPct !== null && (
            <span className="inline-flex items-center gap-1 text-fog">
              <Users className="size-3" aria-hidden />
              <span className="font-semibold tabular-nums text-mist">{p.crowdWithPct}%</span>
              <span>of {p.crowdTotal.toLocaleString()} agree</span>
            </span>
          )}

          {p.challenge && (
            <span className="inline-flex items-center gap-1 rounded-md border border-gold-500/40 bg-gold-500/12 px-1.5 py-0.5 font-bold uppercase tracking-wide text-gold-300">
              {p.challenge.state === "ACTIVE" && p.challenge.opponentName
                ? `vs ${p.challenge.opponentName}`
                : p.challenge.state === "WAITING" ? "Challenge open"
                : p.challenge.state === "RESOLVED" ? "Challenge settled"
                : "Challenge"}
            </span>
          )}
        </div>

        {/* Countdown + date. The countdown is the thing that makes the section
            feel alive; the date is what makes it legible once the countdown has
            run out or when motion is reduced. */}
        <div className="flex items-center justify-between gap-2 border-t border-ink-800 pt-2 text-2xs text-fog">
          <span className="inline-flex items-center gap-1.5">
            {/* The countdown renders digits only, so it is labelled here rather
                than left as bare numbers to a screen reader. */}
            <span className="sr-only">Time until this fight: </span>
            <Countdown date={p.date} compact />
          </span>
          <span className="inline-flex items-center gap-1 transition-colors group-hover:text-blood-300">
            {formatDate(p.date, { month: "short", day: "numeric" })}
            <ArrowRight className="size-3" aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}
