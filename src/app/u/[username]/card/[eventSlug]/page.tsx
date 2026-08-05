import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Swords } from "lucide-react";
import { getEventScorecard } from "@/lib/identity/scorecard";
import { EventScorecard } from "@/components/identity/event-scorecard";
import { ShareMenu } from "@/components/share-menu";
import { ButtonLink } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { getCurrentUser } from "@/lib/auth";

// ── Event Scorecard page ────────────────────────────────────────────────────
// The shareable "how my night went" — the personal companion to The Room. Public
// URL, colocated OG image, links into the event recap. Mirrors the per-pick
// Victory Card route (/u/<user>/call/<fight>): same pattern, event-level unit.

type Params = { username: string; eventSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { username, eventSlug } = await params;
  const card = await getEventScorecard(username, eventSlug);
  if (!card) return {};
  const title = `${card.user.name}: ${card.correct}/${card.graded} on ${card.event.name}`;
  const desc = `${card.headline} ${card.user.name} went ${card.correct} of ${card.graded} (${card.accuracy}%) on ${card.event.name}.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `/u/${card.user.username}/card/${card.event.slug}` },
    openGraph: { title, description: desc },
    twitter: { card: "summary_large_image", title, description: desc },
  };
}

export default async function ScorecardPage({ params }: { params: Promise<Params> }) {
  const { username, eventSlug } = await params;
  const [card, viewer] = await Promise.all([
    getEventScorecard(username, eventSlug),
    getCurrentUser().catch(() => null),
  ]);
  if (!card) notFound();

  const isMine = viewer?.username === card.user.username;
  const shareTitle = `${card.headline} ${card.correct}/${card.graded} on ${card.event.name}`;

  return (
    <div className="px-4 pb-16 pt-5">
      <div className="mx-auto max-w-md">
        <BackButton fallback={`/events/${card.event.slug}`} className="mb-3" />

        <EventScorecard card={card} />

        <div className="mt-5 flex items-center justify-center gap-3">
          <ShareMenu
            path={`/u/${card.user.username}/card/${card.event.slug}`}
            title={shareTitle}
            label={isMine ? "Share your card" : "Share this"}
          />
          <Link
            href={`/events/${card.event.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:text-chalk"
          >
            The event <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {!isMine && (
          <div className="mt-8 flex flex-col items-center gap-3 card-surface p-6 text-center">
            <span className="grid size-11 place-items-center rounded-lg border border-blood-500/40 bg-blood-500/12 text-blood-400">
              <Swords className="size-5" />
            </span>
            <p className="font-display text-sm font-bold text-chalk">Think you can call a card better?</p>
            <p className="-mt-1 text-2xs text-fog">Predict the next one and build a record like this.</p>
            <ButtonLink href="/events" size="sm">Call the next card</ButtonLink>
          </div>
        )}
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
