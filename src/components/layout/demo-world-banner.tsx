import { DEMO_WORLD } from "@/lib/demo-world";

// A subtle, honest indicator shown ONLY on the demo environment. Keeps the
// experience transparent for testers without alarming wording. Renders nothing
// anywhere NEXT_PUBLIC_SEED_WORLD is unset (production, local).
export function DemoWorldBanner() {
  if (!DEMO_WORLD) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[150]">
      <span
        title="This environment contains simulated community data for testing purposes."
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-volt-500/40 bg-ink-900/90 px-3 py-1 text-[0.65rem] font-bold uppercase tracking-wider text-volt-300 shadow-lg backdrop-blur"
      >
        <span className="size-1.5 rounded-full bg-volt-400" /> Demo World
      </span>
    </div>
  );
}
