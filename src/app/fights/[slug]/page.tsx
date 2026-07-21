import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { prisma } from "@/lib/db";
import { getOddsForFight } from "@/lib/repo";
import { marketProbability } from "@/lib/market";
import { getCurrentUser } from "@/lib/auth";
import { getCrowdForFight, getMyPick } from "@/lib/picks";
import { resolvePromotion } from "@/lib/promotions";
import { formatDate } from "@/lib/utils";
import { BoutPick } from "@/components/predictions/bout-pick";
import { FightRoom } from "@/components/fight/fight-room";
import { TaleOfTape } from "@/components/fight/tale-of-tape";

// ════════════════════════════════════════════════════════════════════════════
//  /fights/[slug] — the matchup page.
//
//  A second ENTRY POINT, not a second implementation. Search, shares and
//  deep-links land here; the event page stays the primary experience. Every
//  block below is the same component the event page's fight module renders
//  (BoutPick, FightRoom), plus the tale of the tape that only makes sense with
//  a full-width canvas. Nothing about predictions, battles or rooms is forked.
// ════════════════════════════════════════════════════════════════════════════

function loadFight(slug: string) {
  return prisma.fight.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, date: true, result: true, method: true, roundEnded: true, timeEnded: true,
      scheduledRounds: true, titleFight: true, mainEvent: true, coMain: true, winnerId: true, redId: true, blueId: true,
      weightClass: { select: { name: true } },
      red: { select: { slug: true, name: true, nickname: true, countryCode: true, nationality: true, wins: true, losses: true, draws: true, koWins: true, koLosses: true, heightCm: true, reachCm: true, stance: true, gym: true, birthDate: true, imageUrl: true, thumbUrl: true, sport: true } },
      blue: { select: { slug: true, name: true, nickname: true, countryCode: true, nationality: true, wins: true, losses: true, draws: true, koWins: true, koLosses: true, heightCm: true, reachCm: true, stance: true, gym: true, birthDate: true, imageUrl: true, thumbUrl: true, sport: true } },
      event: { select: { slug: true, name: true, date: true, venue: true, city: true, country: true, promotion: true } },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const f = await loadFight(slug);
  if (!f) return {};
  const title = `${f.red.name} vs ${f.blue.name}`;
  const when = formatDate(f.date.toISOString(), { month: "long", day: "numeric", year: "numeric" });
  const where = [f.event?.venue, f.event?.city].filter(Boolean).join(", ");
  return {
    title,
    description: `${title}${f.event ? ` at ${f.event.name}` : ""} — ${when}${where ? `, ${where}` : ""}. Tale of the tape, records, the crowd prediction and the fight's discussion room.`,
    alternates: { canonical: `/fights/${f.slug}` },
    openGraph: { title, type: "article" },
  };
}

export default async function FightPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fight = await loadFight(slug);
  if (!fight) notFound();

  const viewer = await getCurrentUser();
  const [odds, crowd, myPick] = await Promise.all([
    getOddsForFight(fight.slug),
    getCrowdForFight(fight.slug),
    viewer ? getMyPick(viewer.id, fight.slug) : Promise.resolve(null),
  ]);
  const market = marketProbability(odds);
  const accent = resolvePromotion(fight.event?.promotion ?? undefined).brand;
  const scheduled = fight.result === "SCHEDULED";
  // Winner corner, robust to winnerId being stored as a Fighter id OR slug —
  // the same rule the resolution engine applies.
  const won: "red" | "blue" | null =
    fight.result !== "WIN" || !fight.winnerId ? null
    : fight.winnerId === fight.redId || fight.winnerId === fight.red.slug ? "red"
    : fight.winnerId === fight.blueId || fight.winnerId === fight.blue.slug ? "blue"
    : null;

  return (
    <div style={{ "--accent": accent } as React.CSSProperties} className="px-4 pb-16 pt-4">
      <div className="mx-auto max-w-3xl">
        {fight.event && (
          <Link
            href={`/events/${fight.event.slug}#fight-${fight.slug}`}
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-fog transition-colors hover:text-blood-300"
          >
            <ArrowLeft className="size-3.5" /> {fight.event.name}
          </Link>
        )}

        <h1 className="font-display text-2xl font-black leading-tight text-chalk sm:text-3xl">
          {fight.red.name} <span className="text-fog">vs</span> {fight.blue.name}
        </h1>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fog">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-blood-400" />
            {formatDate(fight.date.toISOString(), { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </span>
          {(fight.event?.venue || fight.event?.city) && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5 text-blood-400" />
              {[fight.event.venue, fight.event.city, fight.event.country].filter(Boolean).join(", ")}
            </span>
          )}
          {fight.weightClass && <span>{fight.weightClass.name}</span>}
          <span className="tabular-nums">{fight.scheduledRounds} rounds</span>
          {fight.titleFight && <span className="rounded bg-gold-500/15 px-1.5 py-0.5 font-bold uppercase tracking-wide text-gold-300">Title</span>}
          {fight.mainEvent && <span className="rounded bg-blood-500/15 px-1.5 py-0.5 font-bold uppercase tracking-wide text-blood-300">Main event</span>}
        </div>

        {!scheduled && (
          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4 text-sm">
            {won ? (
              <p className="text-chalk">
                <span className="font-display font-bold text-blood-300">{won === "red" ? fight.red.name : fight.blue.name}</span>{" "}
                <span className="text-fog">
                  def. {won === "red" ? fight.blue.name : fight.red.name}
                  {fight.method ? ` · ${fight.method}` : ""}
                  {fight.roundEnded ? ` · R${fight.roundEnded}` : ""}
                  {fight.timeEnded ? ` ${fight.timeEnded}` : ""}
                </span>
              </p>
            ) : (
              <p className="text-mist">{fight.result === "DRAW" ? "Draw" : fight.result === "NO_CONTEST" ? "No contest" : "Result pending"}</p>
            )}
          </div>
        )}

        <div className="mt-6">
          <TaleOfTape red={fight.red} blue={fight.blue} />
        </div>

        {scheduled && (
          <div className="mt-6">
            <BoutPick
              fightSlug={fight.slug}
              redName={fight.red.name}
              blueName={fight.blue.name}
              initialCrowd={crowd}
              initialPick={myPick}
              marketRedP={market?.redP ?? null}
            />
          </div>
        )}

        {/* The same arena the event page opens — one implementation, two doors. */}
        <div className="mt-6">
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-[0.18em] text-fog">The room</h2>
          <FightRoom fightSlug={fight.slug} />
        </div>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
