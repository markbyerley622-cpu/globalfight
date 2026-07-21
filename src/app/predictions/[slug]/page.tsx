import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";

// The per-bout prediction surface has been folded into the single canonical
// event experience (/events/[slug]#predictions), where the pick control and an
// inline discussion thread sit on one scroll — the plan's "one surface, never
// two buttons" doctrine. This legacy route forwards there so every deep-link
// (schedule rows, notifications, shared links) lands on the fused page instead
// of a standalone bout page that linked back out to the forum index.
export default async function PredictionRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fight = await prisma.fight.findUnique({
    where: { slug },
    select: { event: { select: { slug: true } } },
  });
  if (!fight?.event) notFound();
  redirect(`/events/${fight.event.slug}#predictions`);
}

export const dynamic = "force-dynamic";
