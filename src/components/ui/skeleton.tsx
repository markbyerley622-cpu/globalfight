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
