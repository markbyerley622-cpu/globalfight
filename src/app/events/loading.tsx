import { PageSkeleton } from "@/components/ui/skeleton";

// Suspense fallback for the events list (a force-dynamic DB route) so a slow
// query shows a skeleton instead of a frozen previous page / blank main region.
export default function Loading() {
  return <PageSkeleton cards={12} />;
}
