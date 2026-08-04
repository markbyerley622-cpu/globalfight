import { memo, useEffect, useRef, useState } from "react";
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
  const rootRef = useRef<HTMLDivElement>(null);
  // Defaults to visible: without an observer result yet, the strip should
  // animate — most first paints have it on-screen (it's pinned near the
  // bottom tab bar), so "wait for a verdict" would just add a stall.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // Stop paying the compositor cost of an animation nobody can see —
    // e.g. once the strip scrolls out of #main's viewport.
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Nothing live (all expired, or none configured) → render nothing rather than
  // an empty branded strip that reads as a broken component.
  if (sponsors.length === 0) return null;

  // Two copies is the minimum for a seamless -50% loop; a third only exists to
  // keep the strip visually full when the live sponsor count is small. Going
  // wider than that (this used to be an 8x repeat) was pure animated DOM
  // weight for no visual gain — every extra node is another image the
  // compositor has to move every frame on a phone GPU.
  const base = sponsors.length >= 6 ? sponsors : [...sponsors, ...sponsors, ...sponsors];
  const track = [...base, ...base];

  return (
    // Solid background, not backdrop-blur-xl: a blur filter sampling the pixels
    // behind a strip whose *contents* are animating forces a full re-blur every
    // frame — that's the actual source of the reported mobile jitter, not the
    // transform-only marquee itself (already GPU-promoted below).
    <div ref={rootRef} className="sponsors-strip shrink-0 border-t border-ink-800 bg-ink-950">
      <div className="flex items-center gap-3 px-4 py-3 lg:gap-6 lg:px-8 lg:py-5">
        <span className="shrink-0 font-display text-[0.55rem] font-bold uppercase tracking-[0.2em] text-fog lg:text-[0.72rem] lg:tracking-[0.25em]">
          <span className="lg:hidden">Partners</span>
          <span className="hidden lg:inline">Official Partners</span>
        </span>
        <div className="relative flex-1 overflow-hidden mask-fade-r">
          <div className="animate-marquee flex w-max items-center gap-8 lg:gap-16" data-visible={visible}>
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
