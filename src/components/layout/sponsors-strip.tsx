import Image from "next/image";
import Link from "next/link";
import { SPONSORS } from "@/lib/config";

// Official-partners strip pinned above the bottom tab bar. A seamless
// auto-scrolling marquee on all sizes (the base set is repeated so a -50%
// translate lands on an identical frame — no seam). Logos are noticeably larger
// and better spaced on desktop.
export function SponsorsStrip() {
  const base = [...SPONSORS, ...SPONSORS, ...SPONSORS, ...SPONSORS];
  const track = [...base, ...base];

  return (
    <div className="shrink-0 border-t border-ink-800 bg-ink-950/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 py-3 lg:gap-6 lg:px-8 lg:py-5">
        <span className="shrink-0 font-display text-[0.55rem] font-bold uppercase tracking-[0.2em] text-fog lg:text-[0.72rem] lg:tracking-[0.25em]">
          <span className="lg:hidden">Partners</span>
          <span className="hidden lg:inline">Official Partners</span>
        </span>
        <div className="relative flex-1 overflow-hidden mask-fade-r">
          <div className="animate-marquee flex w-max items-center gap-8 lg:gap-16" style={{ animationDuration: "45s" }}>
            {track.map((s, i) => (
              <Link
                key={`${s.name}-${i}`}
                href={s.href}
                aria-label={s.name}
                className="flex h-10 shrink-0 items-center overflow-hidden rounded-md opacity-90 transition-opacity hover:opacity-100 lg:h-16"
              >
                <Image src={s.src} alt={s.name} width={200} height={80} className={`h-10 w-auto rounded-md object-contain lg:h-16 ${s.src.includes("box-iq") ? "scale-[1.4]" : ""}`} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
