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
  labelledBy,
}: {
  promotion?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
  showName?: boolean;
  /**
   * Pass `false` when the CALLER already renders the promotion name beside the
   * mark. The mark then becomes decorative and contributes no accessible name,
   * so the promotion is announced once rather than two or three times.
   */
  labelledBy?: false;
}) {
  const p = resolvePromotion(promotion);
  const s = SIZES[size];

  // The name is announced ONCE, by whichever element is the label.
  //
  // It used to come from three at the same time — a wrapper `title`, the image
  // `alt`, and the fallback badge's own `title` — on top of the caller's own
  // visible text. An event card therefore read "Misfits Boxing Misfits Boxing
  // Misfits Boxing" to a screen reader, and pasted that way too.
  //
  // When the caller already shows the name (`showName`, or its own adjacent
  // label) the mark is DECORATIVE: empty alt, no title. That is the standard
  // treatment for an image sitting next to text that already says the same
  // thing. Otherwise the mark IS the label and keeps the accessible name.
  const decorative = showName || labelledBy === false;
  const accessibleName = decorative ? "" : p.name;

  const mark = p.logo ? (
    <span className={cn("relative inline-flex shrink-0 items-center", s.box)}>
      <Image
        src={p.logo}
        alt={accessibleName}
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
      // Decorative: the monogram is a visual echo of a name already on screen.
      // Announcing "MF" after "Misfits Boxing" is noise, not information.
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : p.name}
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
