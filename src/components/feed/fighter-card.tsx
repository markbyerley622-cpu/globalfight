"use client";

import Link from "next/link";
import Image from "next/image";
import { CalendarDays, Sparkles, Swords, Check, ArrowRight, TrendingUp, MessageSquare } from "lucide-react";
import { Flag } from "@/components/flag";
import { brandedHero } from "@/lib/placeholder";
import { FollowButton } from "@/components/follow-button";
import { AlertsToggle } from "./alerts-toggle";
import type { FeedItem } from "@/lib/following";
import { ButtonLink } from "@/components/ui/button";

// ════════════════════════════════════════════════════════════════════════════
//  The fighter card.
//
//  BUILT FOR THE DATA THAT EXISTS, not the data we wish existed. Measured on
//  the live database: 84 of 2,124 fighters have a usable photograph (4%), the
//  Ranking table is empty, and 1,342 of 2,124 have a non-zero record. A card
//  that assumed a portrait and a ranking would be an empty frame with two
//  blank labels for almost everyone.
//
//  So every row is conditional and the card is still complete without it:
//
//    portrait   → licensed photo, else BRANDED ARTWORK (never an initials
//                 circle — a grey monogram is what made the old feed look
//                 unfinished, and it is the 96% case here)
//    record     → shown whenever it is non-zero
//    ranking    → shown only when ranked; the line is absent otherwise, never
//                 an empty "#— —" placeholder
//    next fight → the whole block, or an explicit "No fight announced" so the
//                 space reads as answered rather than broken
//
//  Follow state is implicit: this card only exists in YOUR Following feed.
//  The alerts pill reflects the real notifyFights preference rather than
//  implying alerts that the push policy would silently drop.
// ════════════════════════════════════════════════════════════════════════════

export function FighterCard({ item }: { item: FeedItem }) {
  const f = item.fighter;
  if (!f) return null;

  const hasPhoto = !!f.photo;
  // Branded artwork carries the wordmark and the discipline glyph, seeded on
  // the slug so a fighter's tile never changes between renders.
  const art = hasPhoto ? f.photo! : brandedHero(f.slug, f.next?.accent ?? null, f.sportSlug);
  const record = f.record && !/^0-0/.test(f.record) ? f.record : null;

  return (
    <div className="overflow-hidden rounded-card border border-ink-700 bg-ink-900/60 transition-colors hover:border-blood-500/40">
      <Link href={item.url} className="group block">
        {/* Ratio reserved before load, so a late portrait cannot shift the page. */}
        <div className="relative aspect-[4/3] overflow-hidden bg-ink-850">
          <Image
            src={art}
            alt={hasPhoto ? `${f.name}, portrait` : `${f.name} — no photograph available`}
            fill
            unoptimized={art.startsWith("/api/img") || art.startsWith("data:")}
            className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/25 to-transparent" />

          {f.badge && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-blood-500 px-2 py-1 font-display text-4xs font-bold uppercase tracking-wide text-white shadow-lg">
              <Sparkles className="size-2.5" />
              {f.badge}
            </span>
          )}

          {f.rank && (
            <span className="absolute left-3 top-3 rounded-md bg-blood-500/90 px-2 py-1 font-display text-3xs font-bold uppercase tracking-wide text-white">
              #{f.rank.rank} {f.rank.weightClass}
            </span>
          )}

          <div className="absolute inset-x-3 bottom-3">
            <div className="flex items-center gap-2">
              {f.countryCode && <Flag code={f.countryCode} size="sm" />}
              <h3 className="min-w-0 truncate font-display text-lg font-black uppercase leading-none tracking-tight text-chalk">
                {f.name}
              </h3>
            </div>
            {record && (
              <p className="mt-1 font-display text-2xs font-bold tracking-wide text-mist">
                {record}
                {f.koWins > 0 && <span className="text-fog"> · {f.koWins} KO</span>}
              </p>
            )}
          </div>
        </div>
      </Link>

      <div className="p-4">
        {f.next ? (
          <FightStory next={f.next} />
        ) : (
          // Answered, not blank. An empty region reads as a broken card.
          <p className="text-xs text-fog">No fight announced</p>
        )}

        {/* Real controls, not status pills. The card is where you manage this
            relationship, so neither of these navigates anywhere. FollowButton is
            the SAME component the fighter profile and event cards use — one
            optimistic implementation, one endpoint. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FollowButton kind="fighter" slug={f.slug} name={f.name} initialFollowing size="sm" />
          <AlertsToggle />
        </div>
      </div>
    </div>
  );
}

type NextFight = NonNullable<NonNullable<FeedItem["fighter"]>["next"]>;

/** Surname only — the split bar and chips are tight, and "Makhachev 61%" reads
 *  faster than a full name that truncates mid-word. */
const surname = (n: string) => n.trim().split(/\s+/).slice(-1)[0] ?? n;

/**
 * The fight, as a living object.
 *
 * The matchup used to be a static "vs X · date" line. It now carries — only
 * when the data exists — a countdown, the crowd split, the market favourite and
 * the room's activity, ending in ONE clear action: predict it, or (if you
 * already have) open the room. Everything here was already in the database; the
 * card just stops making you open three screens to see it.
 */
function FightStory({ next }: { next: NextFight }) {
  return (
    <div>
      <Link href={next.url} className="group/next block">
        <p className="flex items-center justify-between gap-2 font-display text-3xs font-bold uppercase tracking-widest text-blood-400">
          <span>Next fight{next.titleFight ? " · Title" : ""}</span>
          <span className={next.urgent ? "text-gold-300" : "text-fog"}>{next.countdown}</span>
        </p>
        <p className="mt-1 flex items-center gap-1.5 font-display text-sm font-bold text-chalk group-hover/next:text-blood-200">
          <Swords className="size-3.5 shrink-0 text-fog" />
          <span className="truncate">vs {next.opponent}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-fog">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3" />
            {new Date(next.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
          {next.eventName && <span className="truncate">{next.eventName}</span>}
        </p>
      </Link>

      {/* Community split — the crowd, kept visually separate from the market. */}
      {next.crowd && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between gap-2 text-3xs font-bold">
            <span className="truncate text-up">{next.crowd.redPct}% {surname(next.crowd.redName)}</span>
            <span className="truncate text-volt-400">{surname(next.crowd.blueName)} {next.crowd.bluePct}%</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-ink-700">
            <div className="bg-up" style={{ width: `${next.crowd.redPct}%` }} />
            <div className="bg-volt-500" style={{ width: `${next.crowd.bluePct}%` }} />
          </div>
          <p className="mt-0.5 text-4xs uppercase tracking-wide text-fog">
            {next.crowd.total} fan pick{next.crowd.total === 1 ? "" : "s"} · community prediction
          </p>
        </div>
      )}

      {/* Market + room chips. Market is bookmaker-implied, never the crowd. */}
      {(next.odds || next.discussion) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {next.odds && (
            <span className="inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-950/40 px-1.5 py-0.5 text-3xs text-mist">
              <TrendingUp className="size-3 text-gold-400" /> Market: {surname(next.odds.favName)} {next.odds.favPct}%
            </span>
          )}
          {next.discussion && (
            <span className="inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-950/40 px-1.5 py-0.5 text-3xs text-mist">
              <MessageSquare className="size-3 text-blood-400" /> {next.discussion} in the room
            </span>
          )}
        </div>
      )}

      {/* One action. Predict it, or open the room if you already called it. */}
      <ButtonLink href={next.url} size="sm" className="mt-3 flex w-full">
        {next.predicted ? (
          <><Check className="size-3.5" /> You picked {surname(next.predicted.name)} · Open the room</>
        ) : (
          <>Predict this fight <ArrowRight className="size-3.5" /></>
        )}
      </ButtonLink>
    </div>
  );
}
