import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-ink-700/60", className)} />;
}

// Generic interior-page skeleton: hero band + a grid of cards.
export function PageSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <>
      <div className="border-b border-ink-800 bg-ink-900/40">
        <div className="container-cr py-12">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-10 w-72" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
      </div>
      <div className="container-cr py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="card-surface p-4">
              <div className="flex items-center gap-4">
                <Skeleton className="size-14 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Shape-matched skeletons ────────────────────────────────────────────────
// PageSkeleton is a hero + card grid, which is the wrong silhouette for the
// pillar routes: showing a card grid and then swapping in a map or a ranked
// list is a visible layout jump on every navigation. These match what actually
// arrives, so the skeleton settles into the page instead of replacing it.

/** A stack of the app's standard 3-line rows (leaderboard, gyms, feed, sheet). */
export function RowListSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** One-line page header: eyebrow + title + standfirst. */
export function HeaderSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <Skeleton className="h-2.5 w-28" />
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-3.5 w-72 max-w-full" />
    </div>
  );
}

/** Chip row placeholder — keeps the filter strip from popping in. */
export function ChipRowSkeleton({ chips = 4 }: { chips?: number }) {
  return (
    <div className="flex gap-2 overflow-hidden">
      {Array.from({ length: chips }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full" />
      ))}
    </div>
  );
}
