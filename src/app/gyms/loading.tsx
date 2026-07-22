import { HeaderSkeleton, RowListSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-5 lg:max-w-3xl">
      <HeaderSkeleton />
      <Skeleton className="mt-4 h-11 w-full rounded-xl" />
      <RowListSkeleton rows={8} className="mt-4" />
    </div>
  );
}
