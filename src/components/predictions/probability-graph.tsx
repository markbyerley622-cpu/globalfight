"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { HistoryPoint } from "@/features/predictions/types";

/**
 * Lazy probability-history sparkline for a live market's favourite outcome —
 * the provider's own price movement, normalized. Loads only when scrolled near
 * view; renders nothing (collapses) when a provider has no series, so the
 * ConsensusBar above still carries the current split.
 */
export function MarketSparkline({ marketId, className }: { marketId: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "empty">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el || state !== "idle") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void load();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, marketId]);

  async function load() {
    setState("loading");
    try {
      const res = await fetch(`/api/predictions/${encodeURIComponent(marketId)}/history`);
      const data = (await res.json()) as { history: { points?: HistoryPoint[] } | null };
      const pts = data.history?.points ?? [];
      if (pts.length >= 2) {
        setPoints(pts);
        setState("done");
      } else {
        setState("empty");
      }
    } catch {
      setState("empty");
    }
  }

  // Empty collapses to nothing; loading shows a slim shimmer line.
  return (
    <div ref={ref} className={className}>
      {state === "done" && points ? (
        <Sparkline points={points} />
      ) : state === "empty" ? null : (
        <div className="cr-shimmer h-9 w-full rounded-md" />
      )}
    </div>
  );
}

/** Area + line sparkline over [0,1]. Colour + trend tint inherit from currentColor. */
function Sparkline({ points }: { points: HistoryPoint[] }) {
  const W = 300;
  const H = 36;
  const n = points.length;
  const xs = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const ys = (p: number) => H - Math.min(1, Math.max(0, p)) * H;

  const line = points.map((pt, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(pt.p).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = points[n - 1];
  // Green when the favourite trended up over the window, muted red when down.
  const up = last.p >= points[0].p;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-9 w-full", up ? "text-up" : "text-blood-400")}
      role="img"
      aria-label="Probability history"
    >
      <defs>
        <linearGradient id={`pg-${up ? "u" : "d"}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#pg-${up ? "u" : "d"})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={xs(n - 1)} cy={ys(last.p)} r="2.5" fill="currentColor" />
    </svg>
  );
}
