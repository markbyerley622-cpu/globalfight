import { HeaderSkeleton, RowListSkeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-5 lg:max-w-3xl">
      <HeaderSkeleton />
      <RowListSkeleton rows={8} className="mt-4" />
    </div>
  );
}
