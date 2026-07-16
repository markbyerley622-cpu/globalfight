import Image from "next/image";
import Link from "next/link";
import { SPONSORS } from "@/lib/config";
import { cn } from "@/lib/utils";

export type MarqueeItem = { name: string; src?: string; href: string; boxed?: boolean; textOnly?: boolean; small?: boolean };

// Luxury auto-scrolling partner marquee (F1 / Bloomberg feel). Pure CSS infinite
// motion; the track is duplicated so the loop is seamless. Reusable — pass a
// `title` + `items`. `large` scales the whole strip (title, logos, spacing) 1.5×.
export function MarqueeBanner({
  title, items, large,
}: { title: string; items: readonly MarqueeItem[]; large?: boolean }) {
  const half = [...items, ...items, ...items];
  const track = [...half, ...half];

  return (
    <section className="relative overflow-hidden border-y border-ink-800 bg-gradient-to-b from-ink-900/60 to-ink-950">
      <div className="absolute inset-0 bg-grid opacity-[0.15]" />
      <div className={cn("container-cr relative", large ? "py-[3.75rem]" : "py-10")}>
        <div className={cn("flex items-center justify-center gap-4", large ? "mb-[2.625rem]" : "mb-7")}>
          <span className={cn("h-px bg-gradient-to-r from-transparent to-ink-600", large ? "w-16" : "w-10")} />
          <p className={cn("text-center font-display font-semibold uppercase tracking-[0.3em] text-fog", large ? "text-lg" : "text-xs")}>
            {title}
          </p>
          <span className={cn("h-px bg-gradient-to-l from-transparent to-ink-600", large ? "w-16" : "w-10")} />
        </div>
      </div>

      {/* Edge-faded marquee. dir=ltr keeps the scroll direction consistent. */}
      <div
        dir="ltr"
        className={cn("group relative overflow-hidden", large ? "pb-[3.75rem]" : "pb-10")}
        style={{
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
          maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
        }}
      >
        <div className={cn("animate-marquee flex w-max items-center group-hover:[animation-play-state:paused]", large ? "gap-24" : "gap-16")}>
          {track.map((s, i) => {
            const boxed = !!s.boxed;
            const textOnly = !!s.textOnly || !s.src;
            return (
              <Link
                key={`${s.name}-${i}`}
                href={s.href}
                aria-label={s.name}
                className={cn("group/tile relative flex shrink-0 items-center justify-center", large ? "h-60" : "h-40")}
              >
                {textOnly ? (
                  <span className={cn(
                    "whitespace-nowrap font-display font-black uppercase tracking-tight text-mist/70 transition-colors duration-300 hover:text-chalk",
                    large ? "text-5xl" : "text-3xl",
                  )}>
                    {s.name}
                  </span>
                ) : (
                  <Image
                    src={s.src!}
                    alt={s.name}
                    width={240}
                    height={240}
                    className={cn(
                      // uniform box; `small` shrinks full-bleed logos to match padded marks
                      "object-contain transition-all duration-300 hover:opacity-100",
                      s.small ? cn(large ? "size-28" : "size-16", "rounded-xl") : (large ? "size-40" : "size-24"),
                      boxed ? "opacity-90" : "opacity-60 brightness-0 invert",
                    )}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** The original sponsors strip — a thin wrapper over the reusable banner. */
export function Sponsors() {
  return <MarqueeBanner title="Our Official Partners" items={SPONSORS} />;
}
