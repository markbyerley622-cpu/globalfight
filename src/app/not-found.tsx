import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <div className="px-4 py-16">
      <EmptyState
        title="Not found"
        description="That sport, event or bout doesn't exist — it may have been moved or is not part of the demo data."
        action={
          <Link href="/sports/mma" className="rounded-lg bg-blood-500 px-4 py-1.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-[0_8px_30px_-12px_rgba(225,29,42,0.8)] hover:bg-blood-400">
            Back to events
          </Link>
        }
      />
    </div>
  );
}
