import { EventsSkeleton } from "@/components/ui/skeleton";

// Suspense fallback for the events list (a force-dynamic DB route). Uses the
// event-card silhouette so a slow query settles into the grid instead of showing
// a generic avatar-card skeleton that then pops into image-topped cards.
export default function Loading() {
  return <EventsSkeleton cards={12} />;
}
