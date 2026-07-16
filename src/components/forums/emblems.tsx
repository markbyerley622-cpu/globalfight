// Combat Register's custom reaction emblems — minimalist, stroke-based to match
// the lucide icon set. Shared by the thread-card vote rail and the post
// reaction bar so the two never drift.

// Closed fist ("respect" / upvote). Uses the supplied PNG rendered as a CSS mask
// so it inherits `currentColor` — recolors with the theme (idle grey → active red).
export function RespectIcon({ className }: { className?: string; filled?: boolean }) {
  return (
    <span
      role="img"
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        backgroundColor: "currentColor",
        WebkitMaskImage: "url(/respect-cut.png)",
        maskImage: "url(/respect-cut.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

// Middle finger ("disrespect" / downvote). Uses the supplied PNG rendered as a
// CSS mask so it inherits `currentColor` — recolors with the theme exactly like
// a stroke icon (idle grey → active blue). `filled` is accepted for API parity.
export function SaluteIcon({ className }: { className?: string; filled?: boolean }) {
  return (
    <span
      role="img"
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        backgroundColor: "currentColor",
        WebkitMaskImage: "url(/middle-finger-cut.png)",
        maskImage: "url(/middle-finger-cut.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
