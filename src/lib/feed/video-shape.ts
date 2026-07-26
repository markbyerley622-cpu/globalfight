// Pure video-shape classification + phase ordering. NO prisma, NO server-only —
// so it is unit-tested without a database (same split as scoring.ts). recommend.ts
// (the IO wrapper) imports from here.
//
// The "shape" of a video is read from its title. Ordering flips by event phase:
// before a card, fight-week build-up leads; after it, the highlights, recap and
// reaction do (which is why an "Embedded" vlog used to sit above the knockout on
// a finished event).

const SHAPES: { re: RegExp; label: string }[] = [
  { re: /\bhighlight|\bknockout\b|\bko\b|\bfull fight\b|\bfinish\b/i, label: "Highlights" },
  { re: /\brecap\b|\bresults?\b|post[- ]?fight show/i, label: "Recap" },
  { re: /\binterview\b|\bsits down\b|\bone[- ]on[- ]one\b|post[- ]?fight (interview|reaction)/i, label: "Interview" },
  { re: /\bmedia day\b|\bscrum\b/i, label: "Media day" },
  { re: /\bembedded\b|\bfight week\b|\bvlog\b/i, label: "Fight week" },
  { re: /\bpress conference\b|\bpresser\b|\bface[- ]?off\b/i, label: "Press conference" },
  { re: /\bweigh[- ]?in/i, label: "Weigh-ins" },
  { re: /\bcountdown\b|\bpreview\b|\bbreakdown\b/i, label: "Preview" },
];

// After the bell, lead with the fight itself; before it, lead with the build-up.
const ORDER_POST = ["Highlights", "Recap", "Interview", "Preview", "Media day", "Press conference", "Fight week", "Weigh-ins"];
const ORDER_PRE = ["Interview", "Media day", "Fight week", "Press conference", "Weigh-ins", "Preview", "Highlights", "Recap"];

/** The video's editorial shape label, or null when the title reveals none. */
export const shapeLabel = (title: string): string | null =>
  SHAPES.find((s) => s.re.test(title))?.label ?? null;

/** Rank position of a video's shape for the phase (lower = surfaced first). */
export const shapeIndex = (title: string, phase: "pre" | "post"): number => {
  const label = shapeLabel(title);
  const order = phase === "post" ? ORDER_POST : ORDER_PRE;
  const i = label ? order.indexOf(label) : -1;
  return i === -1 ? order.length : i;
};
