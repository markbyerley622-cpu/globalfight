import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="border-b border-ink-800 bg-ink-900/40">
        <div className="container-cr flex flex-col items-center gap-6 py-12 lg:flex-row lg:items-end">
          <Skeleton className="size-32 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-12 w-80 max-w-full" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
      </div>
      <div className="container-cr grid gap-6 py-10 lg:grid-cols-[1fr_1.6fr]">
        <div className="space-y-6">
          <Skeleton className="h-64 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-32 rounded-card" />
          <Skeleton className="h-48 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      </div>
    </>
  );
}
