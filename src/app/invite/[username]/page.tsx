import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Swords, TrendingUp, Trophy, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { publicDisplayName, initialsFor } from "@/lib/display-name";
import { SITE } from "@/lib/config";
import { ButtonLink } from "@/components/ui/button";

// ════════════════════════════════════════════════════════════════════════════
//  The invite landing page.
//
//  A stranger arrives here from a WhatsApp message or an email, knowing nothing.
//  So it answers exactly three things above the fold: who invited them, what this
//  is, and what to press. Everything else is below.
//
//  The URL is the SHAREABLE artefact, which is why the inviter's handle is in the
//  path rather than a query string: a link with `?ref=` gets truncated in previews,
//  stripped by some clients, and reads like tracking.
// ════════════════════════════════════════════════════════════════════════════

async function loadInviter(username: string) {
  return prisma.user.findUnique({
    where: { username },
    select: {
      name: true, username: true, image: true, reputation: true,
      picksResolved: true, picksCorrect: true, bestPickStreak: true,
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const u = await loadInviter(username);
  // "Join Combat Reviews" would render as "Join Combat Reviews · Combat Reviews"
  // once the root layout's title template appends the brand.
  if (!u) return { title: "You're invited" };

  const who = publicDisplayName(u);
  return {
    title: `${who} invited you`,
    description: `${who} wants you calling fights on Combat Reviews. Predict every card, build a record, and settle it in the room.`,
    alternates: { canonical: `/invite/${u.username}` },
    // Explicit openGraph + twitter blocks. Next infers og:image from the sibling
    // opengraph-image route, but the CARD TYPE is what makes X render a large image
    // instead of a thumbnail strip, and that has to be declared.
    openGraph: {
      type: "website",
      url: `${SITE.url}/invite/${u.username}`,
      siteName: "Combat Reviews",
      title: `${who} invited you to Combat Reviews`,
      description: "Call the fights. Build a record. Prove you read it better.",
    },
    twitter: {
      card: "summary_large_image",
      title: `${who} invited you to Combat Reviews`,
      description: "Call the fights. Build a record. Prove you read it better.",
    },
  };
}

export default async function InvitePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const u = await loadInviter(username);
  if (!u?.username) notFound();

  const who = publicDisplayName(u);
  const accuracy = u.picksResolved > 0 ? Math.round((u.picksCorrect / u.picksResolved) * 100) : null;

  return (
    <div className="container-cr max-w-2xl py-12 md:py-16">
      <div className="rounded-card border border-ink-700 bg-gradient-to-b from-blood-500/10 to-transparent p-6 md:p-10">
        <p className="text-2xs font-semibold uppercase tracking-[0.22em] text-blood-400">You&apos;re invited</p>

        <div className="mt-5 flex items-center gap-4">
          <span
            aria-hidden
            className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-squircle border border-ink-700 bg-ink-850 font-display text-xl font-bold text-chalk"
          >
            {initialsFor(u)}
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold uppercase leading-tight text-chalk md:text-3xl">
              {who} wants you on the card
            </h1>
            <p className="mt-1 text-sm text-mist">Call the fights. Build a record. Prove you read it better.</p>
          </div>
        </div>

        {/* Their record — the social proof that makes this an invitation to compete
            rather than an advert. Omitted entirely for a brand-new inviter: a row of
            zeroes is an argument AGAINST joining. */}
        {u.picksResolved > 0 && (
          <dl className="mt-6 grid grid-cols-3 gap-2 border-t border-ink-800 pt-5">
            {[
              { label: "Their rep", value: u.reputation.toLocaleString(), icon: Trophy },
              { label: "Accuracy", value: accuracy !== null ? `${accuracy}%` : "—", icon: TrendingUp },
              { label: "Best streak", value: `${u.bestPickStreak}`, icon: Swords },
            ].map((s) => (
              <div key={s.label} className="rounded-card border border-ink-800 bg-ink-900/60 px-3 py-2.5 text-center">
                <s.icon aria-hidden className="mx-auto size-3.5 text-fog" />
                <dd className="mt-1 font-display text-lg font-bold tabular-nums text-chalk">{s.value}</dd>
                <dt className="text-3xs uppercase tracking-wide text-fog">{s.label}</dt>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-7 flex flex-col gap-2 sm:flex-row">
          {/* `next` carries them into the app rather than dumping them on a dashboard
              after signup, and it names the person who invited them so the first
              thing they can do is follow them back. */}
          <ButtonLink href={`/account?next=/u/${u.username}`} size="lg" className="flex-1 text-sm">
            Create your account
          </ButtonLink>
          <ButtonLink href={`/u/${u.username}`} variant="outline" size="lg" className="text-sm">
            <Users aria-hidden className="size-4" /> See their record
          </ButtonLink>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { t: "Every card", d: "MMA, boxing, Muay Thai, BKFC and more — one schedule." },
          { t: "A real record", d: "Every call is graded. Your accuracy is public." },
          { t: "Settle it", d: "Challenge anyone. The fight is the referee." },
        ].map((f) => (
          <div key={f.t} className="rounded-card border border-ink-800 bg-ink-900/40 p-4">
            <p className="font-display text-sm font-bold uppercase text-chalk">{f.t}</p>
            <p className="mt-1 text-xs leading-relaxed text-fog">{f.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
