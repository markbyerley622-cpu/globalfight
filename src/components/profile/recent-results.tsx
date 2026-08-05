import Link from "next/link";
import { Check, X, Minus, History, Trophy } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PromotionLogo } from "@/components/promotion-logo";
import { formatDate } from "@/lib/utils";
import { isTerminal } from "@/lib/intelligence/pick-status";
import { viewAllHref } from "@/lib/profile/profile-service";
import type { ResultGroup, ResultPick } from "@/lib/profile/types";
import { ProfileSection } from "./profile-section";

/**
 * RECENT RESULTS — the second question a profile answers: how have they been
 * doing lately?
 *
 * Grouped by EVENT because that is how the calls were made. A member who called
 * a whole card produces twelve rows repeating one event name, which reads as
 * noise and buries the thing a visitor is scanning for — how they did on that
 * card. The group header carries the score; the rows carry the detail.
 *
 * Nothing here is computed in the browser. Correctness, the winner, the derived
 * status and the points credited all arrive resolved from the profile service —
 * points from the reputation LEDGER, never a re-run of the scoring formula,
 * which has changed before and would silently disagree with the leaderboard.
 */
export function RecentResults({ groups, more, isSelf }: {
  groups: ResultGroup[];
  more: boolean;
  isSelf: boolean;
}) {
  if (groups.length === 0) {
    return (
      <ProfileSection title="Recent results" icon={<History className="size-4" />}>
        <EmptyState
          compact
          icon={<Trophy className="size-5 text-gold-400" />}
          title="No completed predictions yet."
          body={
            isSelf
              ? "Once a fight you called is settled, it lands here with the result and what it did to your reputation."
              : "Nothing settled yet — their record will build here as the fights they call resolve."
          }
          action={isSelf ? { href: "/events", label: "Make your first prediction" } : undefined}
        />
      </ProfileSection>
    );
  }

  return (
    <ProfileSection
      title="Recent results"
      icon={<History className="size-4" />}
      viewAll={more ? { href: viewAllHref("completed"), label: "View all" } : undefined}
      isSelf={isSelf}
    >
      <div className="space-y-3">
        {groups.map((g) => <Group key={g.eventSlug ?? g.eventName} group={g} />)}
      </div>
    </ProfileSection>
  );
}

function Group({ group: g }: { group: ResultGroup }) {
  return (
    <div className="overflow-hidden rounded-card border border-ink-800 bg-ink-900/60">
      <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-950/40 px-3.5 py-2">
        {g.promotion && <PromotionLogo promotion={g.promotion} size="sm" />}
        {g.eventSlug ? (
          <Link
            href={`/events/${g.eventSlug}`}
            className="min-w-0 flex-1 truncate font-display text-xs font-bold text-chalk transition-colors hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            {g.eventName}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate font-display text-xs font-bold text-chalk">{g.eventName}</span>
        )}
        {/* The card score — the one number that summarises a night. Only shown
            when something was actually graded, so a card of voided bouts does
            not advertise "0/0". */}
        {g.gradedCount > 0 && (
          <span className="shrink-0 rounded-full bg-ink-800 px-2 py-0.5 text-3xs font-bold tabular-nums text-mist">
            {g.correctCount}/{g.gradedCount}
          </span>
        )}
        <span className="shrink-0 text-3xs text-fog">
          {formatDate(g.date, { month: "short", day: "numeric" })}
        </span>
      </div>
      <ul className="divide-y divide-ink-800/70">
        {g.picks.map((p) => <Row key={p.fightSlug} pick={p} />)}
      </ul>
    </div>
  );
}

function Row({ pick: p }: { pick: ResultPick }) {
  const graded = isTerminal(p.status) && p.correct !== null;
  const correct = graded && p.correct === true;
  const missed = graded && p.correct === false;

  return (
    <li>
      <Link
        href={`/fights/${p.fightSlug}`}
        className="flex items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
      >
        {/* ICON + TEXT, never colour alone. The verdict is announced to a screen
            reader and readable to anyone who cannot separate green from red. */}
        <span
          className={`grid size-6 shrink-0 place-items-center rounded-full border ${
            correct ? "border-up/50 bg-up/15 text-up"
            : missed ? "border-blood-500/50 bg-blood-500/15 text-blood-300"
            : "border-ink-700 bg-ink-800 text-fog"
          }`}
        >
          {correct ? <Check className="size-3.5" strokeWidth={3} aria-hidden />
            : missed ? <X className="size-3.5" strokeWidth={3} aria-hidden />
            : <Minus className="size-3.5" aria-hidden />}
          <span className="sr-only">
            {correct ? "Correct" : missed ? "Incorrect" : "Not counted"}
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-chalk">
            <span className="font-semibold">{p.pickedName}</span>
            {p.finish && <span className="text-fog"> · {p.finish}</span>}
          </span>
          {/* WHO ACTUALLY WON — the line that makes a miss informative rather
              than just a red cross. Suppressed when it would only repeat the
              pick back on a correct call. */}
          <span className="block truncate text-3xs text-fog">
            {p.winnerName
              ? correct ? `Won · ${p.redName} vs ${p.blueName}` : `${p.winnerName} won`
              : graded ? `${p.redName} vs ${p.blueName}` : "No result recorded"}
          </span>
        </span>

        {/* Points, from the ledger. Signed and tabular so a column of them
            scans; absent rather than "0" when nothing was credited. */}
        {p.points !== null && p.points !== 0 && (
          <span
            className={`shrink-0 font-display text-xs font-black tabular-nums ${
              p.points > 0 ? "text-up" : "text-blood-300"
            }`}
          >
            {/* ONE text node. `{"+"}{p.points}` is two adjacent children, and
                React separates those with an HTML comment in the server output —
                so the number rendered as `+<!-- -->12`. Invisible on screen, but
                it splits the value for anything reading the DOM: a copy/paste, a
                screen reader, a test. */}
            {`${p.points > 0 ? "+" : ""}${p.points}`}
            <span className="sr-only"> reputation</span>
          </span>
        )}
      </Link>
    </li>
  );
}
