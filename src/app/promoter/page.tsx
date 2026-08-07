import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getViewerPromoter } from "@/lib/promoter/repo";
import { promoterCapabilities, PROMOTER_STATE_COPY } from "@/lib/promoter/verification";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { PageHero } from "@/components/page-hero";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Your events",
  robots: { index: false, follow: false },
};

/** Every event this organisation has, soonest first. The promoter's front door. */
export default async function PromoterHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/account?returnTo=${encodeURIComponent("/promoter")}`);

  const promoter = await getViewerPromoter(user.id);
  const caps = promoter ? promoterCapabilities(promoter.state) : null;
  const copy = PROMOTER_STATE_COPY[promoter?.state ?? "NONE"];

  if (!promoter || !caps?.draftEvents) {
    return (
      <>
        <PageHero eyebrow="Promoters" title="Host your events" description={copy.detail} />
        <div className="container-cr py-8">
          <EmptyState
            icon={<Megaphone className="size-6" />}
            title={copy.label}
            body={copy.detail}
            action={{ href: "/account", label: "Your account" }}
          />
        </div>
      </>
    );
  }

  const events = await prisma.event.findMany({
    where: { promoterOrgId: promoter.orgId },
    // Soonest FIRST — a promoter's attention is on what is next, not on what is
    // newest. An events list sorted by createdAt buries tomorrow's card under
    // whatever was drafted most recently.
    orderBy: { date: "asc" },
    take: 60,
    select: {
      id: true, name: true, date: true, status: true, venue: true, city: true,
      _count: { select: { fights: true } },
    },
  });

  return (
    <>
      <PageHero
        eyebrow={promoter.orgName}
        title="Your events"
        description="Upload a poster and we'll build the card for you."
      />

      <div className="container-cr space-y-4 py-6">
        <Link
          href="/promoter/new"
          className="tap flex min-h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-blood-500 font-display text-sm font-black uppercase tracking-wider text-white shadow-[0_12px_40px_-12px_rgba(225,29,42,0.9)] transition-colors hover:bg-blood-400"
        >
          <Plus className="size-5" aria-hidden /> Host an event
        </Link>

        {events.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-6" />}
            title="No events yet"
            body="Upload your poster and we'll read the fighters, the date and the venue off it. You review, you publish — that's it."
            action={{ href: "/promoter/new", label: "Upload a poster" }}
          />
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/promoter/events/${e.id}`}
                  className="flex min-h-16 items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/50 px-3.5 py-3 transition-colors hover:border-blood-500/40 hover:bg-ink-900"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-bold text-chalk">{e.name}</span>
                    <span className="block truncate text-xs text-fog">
                      {formatDate(e.date.toISOString(), { weekday: "short", month: "short", day: "numeric" })}
                      {e.venue && ` · ${e.venue}`}
                      {e._count.fights > 0 && ` · ${e._count.fights} bout${e._count.fights === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <Badge tone={e.status === "LIVE" ? "live" : "neutral"}>{e.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export const dynamic = "force-dynamic";
