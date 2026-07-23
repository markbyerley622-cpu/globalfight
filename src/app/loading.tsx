import { PageSkeleton } from "@/components/ui/skeleton";

// Root-level Suspense fallback — covers the landing route and any segment that
// doesn't ship its own loading.tsx, so a slow dynamic render never leaves the
// main region blank on cold navigation.
export default function Loading() {
  return <PageSkeleton cards={8} />;
}
