import { cn } from "@/lib/utils";

/**
 * Shown on a registry screen when live data couldn't be loaded and the curated
 * fixture was served instead — so a populated-with-samples screen never looks
 * identical to real live data, but also never renders blank beside other
 * mock-fed sections.
 */
export function SampleDataNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-2 text-xs font-medium text-gold-300",
        className,
      )}
    >
      We couldn’t load live registry data. Showing curated sample data.
    </p>
  );
}
