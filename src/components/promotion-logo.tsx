import Image from "next/image";
import { resolvePromotion } from "@/lib/promotions";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: "h-8", pad: "px-2 text-xs", img: 32 },
  md: { box: "h-10", pad: "px-2.5 text-sm", img: 40 },
  lg: { box: "h-14", pad: "px-3 text-base", img: 56 },
} as const;

/**
 * The organisation mark shown beside every event title. Renders the official
 * transparent logo when one has been placed under public/promotions/ (set on the
 * registry entry), otherwise a branded monogram badge in the org's colour — so
 * every event communicates its promotion with a consistent, never-broken mark.
 *
 * Reusable: one component, one registry ([[src/lib/promotions.ts]]). Logos are
 * rendered with object-contain (never stretched) and lazy-loaded by default.
 */
export function PromotionLogo({
  promotion,
  size = "md",
  className,
  showName = false,
}: {
  promotion?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
  showName?: boolean;
}) {
  const p = resolvePromotion(promotion);
  const s = SIZES[size];

  const mark = p.logo ? (
    <span className={cn("relative inline-flex shrink-0 items-center", s.box)} title={p.name}>
      <Image
        src={p.logo}
        alt={p.name}
        width={s.img}
        height={s.img}
        loading="lazy"
        // SVG: skip the optimizer (it rejects SVG by default) — these marks are
        // tiny and already vector, so there's nothing to optimise.
        unoptimized
        className={cn("object-contain", s.box)}
        style={{ maxHeight: "100%", width: "auto" }}
      />
    </span>
  ) : (
    <span
      title={p.name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-display font-bold uppercase leading-none tracking-tight text-white shadow-sm",
        s.box,
        s.pad,
      )}
      style={{ backgroundColor: p.brand }}
    >
      {p.mark}
    </span>
  );

  if (!showName) return <span className={className}>{mark}</span>;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {mark}
      <span className="truncate font-medium text-chalk">{p.name}</span>
    </span>
  );
}
