import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl pb-16 lg:max-w-3xl">
      <div className="cr-shimmer h-36 border-b border-ink-800 sm:h-44" />
      <div className="px-4">
        <Skeleton className="-mt-9 size-[74px] rounded-2xl" />
        <Skeleton className="mt-3 h-7 w-56" />
        <div className="mt-2 flex gap-1.5">
          <Skeleton className="h-5 w-20 rounded-md" />
          <Skeleton className="h-5 w-16 rounded-md" />
        </div>
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
        <Skeleton className="mt-5 h-32 w-full rounded-2xl" />
      </div>
    </div>
  );
}
