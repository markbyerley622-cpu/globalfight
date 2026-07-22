import { ChipRowSkeleton, HeaderSkeleton, RowListSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="px-4 pb-16 pt-5">
      <div className="mx-auto max-w-2xl">
        <HeaderSkeleton className="mb-4" />
        <ChipRowSkeleton chips={4} />
        <RowListSkeleton rows={7} className="mt-4" />
      </div>
    </div>
  );
}
