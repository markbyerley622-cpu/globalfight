import { ChipRowSkeleton, HeaderSkeleton, RowListSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="container-cr py-6 lg:py-8">
      <HeaderSkeleton className="mb-5" />
      <ChipRowSkeleton chips={2} />
      <div className="mt-4"><ChipRowSkeleton chips={3} /></div>
      {/* The podium is the page's anchor — omitting it is the layout jump. */}
      <Skeleton className="mt-5 h-36 w-full rounded-2xl" />
      <RowListSkeleton rows={8} className="mt-4" />
    </div>
  );
}
