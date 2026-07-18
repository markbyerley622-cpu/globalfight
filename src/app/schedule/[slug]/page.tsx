import { redirect } from "next/navigation";

// One canonical event experience. The event page (/events/[slug]) is the single
// source of truth for layout — hero, schedule, main event, fight card, coverage,
// predictions, discussion. This legacy route just forwards there so every entry
// point (schedule list, notifications, feed) lands on the same design, with no
// duplicated layout to keep in sync.
export default async function ScheduleEventRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/events/${slug}`);
}

export const dynamic = "force-dynamic";
