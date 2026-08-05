import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Swords } from "lucide-react";
import { getVictoryCard } from "@/lib/identity/victory-card";
import { VictoryCard } from "@/components/identity/victory-card";
import { ShareMenu } from "@/components/share-menu";
import { ButtonLink } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { getCurrentUser } from "@/lib/auth";

// ── The Prediction Victory Card page ────────────────────────────────────────
// A public, shareable artifact for one resolved call. The URL is stable and
// SEO-clean (/u/<user>/call/<fight>), the OG image is rendered by the colocated
// opengraph-image.tsx, and the on-screen card is the premium collectible. This
// is the surface a user lands on from their own share — so it closes on a CTA
// that converts a viewer into a predictor (organic acquisition loop).

type Params = { username: string; fightSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { username, fightSlug } = await params;
  const card = await getVictoryCard(username, fightSlug);
  if (!card) return {};
  const who = card.user.name;
  const desc = card.socialProof
    ? `${card.headline.text} ${card.socialProof} — ${who} on Combat Reviews.`
    : `${card.headline.text} ${who} called ${card.pick.calledName} on ${card.fight.eventName ?? "the card"}.`;
  const title = `${who}: ${card.headline.text}`;
  return {
    title,
    description: desc,
    alternates: { canonical: `/u/${card.user.username}/call/${card.fight.slug}` },
    // opengraph-image.tsx is auto-detected by Next; keep the OG title/desc aligned.
    openGraph: { title, description: desc },
    twitter: { card: "summary_large_image", title, description: desc },
  };
}

export default async function VictoryCardPage({ params }: { params: Promise<Params> }) {
  const { username, fightSlug } = await params;
  const [card, viewer] = await Promise.all([
    getVictoryCard(username, fightSlug),
    getCurrentUser().catch(() => null),
  ]);
  if (!card) notFound();

  const isMine = viewer?.username === card.user.username;
  const shareTitle = card.socialProof
    ? `${card.headline.text} ${card.socialProof}`
    : `${card.headline.text} — my call on Combat Reviews`;

  return (
    <div className="px-4 pb-16 pt-5">
      <div className="mx-auto max-w-md">
        <BackButton fallback={`/u/${card.user.username}`} className="mb-3" />

        <VictoryCard card={card} />

        {/* Share — the whole point. Prominent for the owner, still available to
            anyone (a viewer re-sharing is more free distribution). */}
        <div className="mt-5 flex items-center justify-center gap-3">
          <ShareMenu
            path={`/u/${card.user.username}/call/${card.fight.slug}`}
            title={shareTitle}
            label={isMine ? "Share your call" : "Share this"}
          />
          {card.fight.eventSlug && (
            <Link
              href={`/events/${card.fight.eventSlug}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:text-chalk"
            >
              The card <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>

        {/* Acquisition CTA — a shared card lands strangers here; convert them. */}
        {!isMine && (
          <div className="mt-8 flex flex-col items-center gap-3 card-surface p-6 text-center">
            <span className="grid size-11 place-items-center rounded-lg border border-blood-500/40 bg-blood-500/12 text-blood-400">
              <Swords className="size-5" />
            </span>
            <p className="font-display text-sm font-bold text-chalk">Think you can call them better?</p>
            <p className="-mt-1 text-2xs text-fog">Make your own predictions and build a record like this.</p>
            <ButtonLink href="/events" size="sm">Call the next card</ButtonLink>
          </div>
        )}
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
