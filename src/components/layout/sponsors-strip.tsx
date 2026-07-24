import { memo } from "react";
import { activeSponsors } from "@/lib/sponsors";
import { SponsorMark } from "@/components/sponsor-mark";

// Official-partners strip pinned above the bottom tab bar. A seamless
// auto-scrolling marquee on all sizes (the base set is repeated so a -50%
// translate lands on an identical frame — no seam). Logos are noticeably larger
// and better spaced on desktop.
//
// memo'd: it lives in the always-mounted app shell, which re-renders on unrelated
// state (nav sheet, online-count/notification polling). Without memo those
// re-renders reconciled the whole logo track on a timer; the marquee's animation
// is pure CSS and its duration lives in the class (no per-render style object),
// so the scroll now runs uninterrupted regardless of shell activity.
export const SponsorsStrip = memo(function SponsorsStrip() {
  const sponsors = activeSponsors();
  // Nothing live (all expired, or none configured) → render nothing rather than
  // an empty branded strip that reads as a broken component.
  if (sponsors.length === 0) return null;

  const base = [...sponsors, ...sponsors, ...sponsors, ...sponsors];
  const track = [...base, ...base];

  return (
    <div className="shrink-0 border-t border-ink-800 bg-ink-950/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 py-3 lg:gap-6 lg:px-8 lg:py-5">
        <span className="shrink-0 font-display text-[0.55rem] font-bold uppercase tracking-[0.2em] text-fog lg:text-[0.72rem] lg:tracking-[0.25em]">
          <span className="lg:hidden">Partners</span>
          <span className="hidden lg:inline">Official Partners</span>
        </span>
        <div className="relative flex-1 overflow-hidden mask-fade-r">
          <div className="animate-marquee flex w-max items-center gap-8 lg:gap-16">
            {track.map((s, i) => (
              <SponsorMark
                key={`${s.id}-${i}`}
                sponsor={s}
                surface="strip"
                className="h-10 overflow-hidden lg:h-16"
                imgClassName="h-10 rounded-md lg:h-16"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
