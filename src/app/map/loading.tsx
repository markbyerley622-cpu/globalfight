import { ChipRowSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Matches the Location layout exactly: header line, layer chips, map slab.
 *  The map itself is the tallest element on the page — without this the route
 *  transition showed nothing at all while 140 events were queried. */
export default function Loading() {
  return (
    <div className="flex flex-col">
      <div className="px-4 pt-3 lg:pt-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 hidden h-3.5 w-80 max-w-full sm:block" />
      </div>
      <div className="px-4 py-2.5">
        <ChipRowSkeleton chips={5} />
      </div>
      <div className="mx-4 mb-4 h-[72dvh] min-h-[26rem] overflow-hidden rounded-2xl border border-ink-700 bg-ink-900">
        <div className="cr-shimmer size-full" />
      </div>
    </div>
  );
}
