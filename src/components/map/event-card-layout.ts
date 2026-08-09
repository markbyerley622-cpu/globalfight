// ════════════════════════════════════════════════════════════════════════════
//  How much room an event card has, and what that means for its layout.
//
//  ── Why these decisions are a pure module ─────────────────────────────────
//  They were spread across the component as `tight ? … : …` at seven call
//  sites, which made the ONE rule that actually matters impossible to state or
//  test: a full-height scrim over the poster exists only to make text that sits
//  ON the poster legible, so a card with no overlaid text must not have one.
//
//  Breaking that rule is what made the mobile card look wrong. The compact
//  layout cropped the hero to a short banner but kept the overlaid title AND
//  the full-height gradient — so on a ~140px hero, a scrim tuned for a 220px
//  one darkened almost the whole image, and the title block ate a third of what
//  was left. The poster read as a murky grey band and the facts underneath got
//  pushed down. Every individual class was defensible; the combination was not.
//
//  Stated here, the rule is one line (`scrim === "full"` implies `titleInHero`)
//  and __tests__/event-card-layout asserts it for every variant that exists —
//  including ones added later.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Where this card is being drawn.
 *
 *   sheet     the mobile bottom sheet — the reader pulled it up, so it has room
 *   floating  the desktop card anchored to a pin
 *   compact   the PHONE card anchored to a pin — the tight one
 */
export type EventCardVariant = "sheet" | "floating" | "compact";

/** How far up the hero the legibility scrim reaches. */
export type Scrim =
  /** No scrim. Nothing is drawn over the image. */
  | "none"
  /** A short scrim at the foot of the hero — enough to seat badges and edges. */
  | "bottom"
  /** Top-to-bottom, for a hero that carries text. */
  | "full";

export interface EventCardLayout {
  /** Hero aspect ratio. Shorter where the card has less room. */
  heroAspect: string;
  /**
   * Does the event's name sit ON the hero, or in normal flow beneath it?
   *
   * Overlaying is the richer treatment and it is right when the hero is tall
   * enough to carry it. On a short hero the title has nowhere to go, so it
   * moves into the content column where it costs nothing to read.
   */
  titleInHero: boolean;
  scrim: Scrim;
  /** Smaller countdown digits. */
  compactCountdown: boolean;
  /** The three community counts. First thing dropped when room is short. */
  showStats: boolean;
  /** The exact date under the countdown — a second reading of the same fact. */
  showDateLine: boolean;
  /** Tailwind gap/padding for the content column. */
  contentSpacing: string;
  /** Title size class. */
  titleSize: string;
  /**
   * The `sizes` hint for the poster.
   *
   * An anchored card has a known pixel width; the sheet spans the viewport.
   * Getting this wrong costs bandwidth on the one image every card loads.
   */
  imageSizes: string;
  /**
   * The crest drawn in place of a missing poster.
   *
   * `lg` is 56px, which is most of a compact hero's 82px at the narrowest card
   * width. A smaller crest in a shorter box reads as deliberate rather than as
   * something that only just fits.
   */
  heroLogoSize: "sm" | "md" | "lg";
  /**
   * Which top corner of the hero the SPORT badge takes.
   *
   * ── Why this is a variant decision and not a constant ─────────────────────
   * The badge wants the corner opposite the state badges — it is the fastest
   * thing to scan a card by, and putting it beside them makes it one more chip
   * in a cluster. But the two variants that render inside FloatingPreview share
   * that corner with the shell's CLOSE button, which is drawn over the card and
   * therefore always wins. The badge was not "too big" on the phone; it was
   * underneath the X, so the sport was simply unreadable.
   *
   * The sheet has no close button over it, so it keeps the opposite corner.
   */
  sportBadge: "left" | "right";
}

const LAYOUTS: Record<EventCardVariant, EventCardLayout> = {
  sheet: {
    heroAspect: "aspect-[16/9]",
    titleInHero: true,
    scrim: "full",
    compactCountdown: false,
    showStats: true,
    showDateLine: true,
    contentSpacing: "gap-2.5 p-3",
    titleSize: "text-base",
    imageSizes: "(max-width: 1024px) 100vw, 420px",
    heroLogoSize: "lg",
    // No close button is drawn over the sheet card, so the opposite corner is
    // genuinely free here.
    sportBadge: "right",
  },
  floating: {
    heroAspect: "aspect-[16/9]",
    titleInHero: true,
    scrim: "full",
    compactCountdown: true,
    showStats: true,
    showDateLine: true,
    contentSpacing: "gap-2.5 p-3",
    titleSize: "text-sm",
    imageSizes: "360px",
    heroLogoSize: "lg",
    // Shares its top-right with FloatingPreview's close button.
    sportBadge: "left",
  },
  compact: {
    // A BANNER, not a poster.
    //
    // 3.2:1 is ~82px on the narrowest card this can be drawn at (264px wide, on
    // a 320px device) and ~114px on a 390px phone. Deliberately shorter than
    // the 2.6:1 it replaced, and the two changes pay for each other: moving the
    // title into normal flow costs a row of about 34px, and cropping the hero
    // returns most of it. The card ends up marginally taller than before and
    // dramatically more legible — the poster is now seen rather than tinted,
    // and the title is not competing with two badges inside 100 pixels.
    //
    // A hero this short can carry no text, which is exactly why `titleInHero`
    // is false below and why the scrim is only a foot.
    heroAspect: "aspect-[3.2/1]",
    // ── The change that fixes the card ──
    // The title moves into normal flow. Nothing is layered over the poster
    // except the badges, which carry their own backgrounds, so the image is
    // seen rather than tinted.
    titleInHero: false,
    // And therefore only a short scrim — enough that the poster's own bright
    // edges do not collide with the card body beneath it.
    scrim: "bottom",
    compactCountdown: true,
    showStats: false,
    showDateLine: false,
    contentSpacing: "gap-2 p-2.5",
    titleSize: "text-sm",
    // The card is the viewport minus gutters, capped by FloatingPreview.
    imageSizes: "100vw",
    heroLogoSize: "md",
    // The corner that was hiding the sport on every phone. See `sportBadge`.
    sportBadge: "left",
  },
};

export function eventCardLayout(variant: EventCardVariant): EventCardLayout {
  return LAYOUTS[variant] ?? LAYOUTS.sheet;
}

/** Every variant, for tests that must cover all of them rather than a list. */
export const EVENT_CARD_VARIANTS = Object.keys(LAYOUTS) as EventCardVariant[];

/**
 * The invariant, expressed once so a test can assert it.
 *
 * A full-height scrim is a cost paid for a benefit: it darkens the whole poster
 * so that text sitting on the poster stays readable. A card with no text on its
 * hero pays that cost for nothing — which is precisely the bug this module was
 * extracted to make impossible.
 */
export function scrimIsJustified(layout: EventCardLayout): boolean {
  return layout.scrim !== "full" || layout.titleInHero;
}

// ── Sizing the anchored card ────────────────────────────────────────────────

/** Card box, and the breathing room around it. Read by FloatingPreview. */
export const CARD_W = 340;
export const CARD_GAP = 18;
export const CARD_EDGE = 12;

/**
 * Below this container width there is no room BESIDE a pin for a full card, so
 * the layout changes: the card sits above the pin, centred, and shrinks to fit.
 * That is the phone case.
 */
export const CARD_NARROW = CARD_W + CARD_GAP + CARD_EDGE * 2;

/**
 * How wide the anchored card should be inside a container of `containerWidth`.
 *
 * Extracted from FloatingPreview's layout effect so the narrow end can actually
 * be checked. The 320px device is the one that matters and the one nobody has
 * to hand: at that width the map box is ~288px after its gutters, and the card
 * has to fit inside it with an edge margin and still be wide enough for a
 * three-cell countdown and a two-name main-event row.
 */
/**
 * The smallest a card is ever squeezed to.
 *
 * Below this it stops being a card and becomes a sliver with a scrollbar, so a
 * container too short to hold one is better off with the card overhanging than
 * with a 40px stub.
 */
export const CARD_MIN_H = 140;

/**
 * How tall the anchored card may be.
 *
 * `bottomInset` is the strip at the foot of the container that something ELSE
 * is drawing over — on phones, the bottom sheet, which is opaque and painted
 * above the card. Height budgeted from the container alone is the bug: it lets
 * a card be "inside the container" and behind the sheet at the same time.
 */
export function previewHeightBudget(containerH: number, bottomInset = 0): number {
  return Math.max(CARD_MIN_H, containerH - bottomInset - CARD_EDGE * 2);
}

/**
 * Where the top of the anchored card goes, in container pixels.
 *
 * Pure so the cases that only happen on a real phone — a pin near the top of a
 * short map with a half-open sheet under it — can be asserted without a DOM.
 * `cardH` must already be capped to `previewHeightBudget`.
 */
export function previewCardTop({
  containerH, bottomInset = 0, anchorY, cardH, narrow,
}: {
  containerH: number;
  bottomInset?: number;
  anchorY: number;
  cardH: number;
  narrow: boolean;
}): number {
  const min = CARD_EDGE;
  // The floor is the top of whatever owns the bottom of the container, not the
  // bottom of the container.
  const max = Math.max(min, containerH - bottomInset - cardH - CARD_EDGE);

  if (!narrow) {
    // Beside the pin: vertically centred on it, then clamped.
    return Math.min(Math.max(anchorY - cardH / 2, min), max);
  }

  // Phone: ABOVE the pin, so the card never covers the thing it describes.
  //
  // Still clamped to `max`, because the PIN can be under the sheet too — a
  // marker low on the map puts "just above the pin" squarely inside the strip
  // the sheet owns, and the card would disappear behind it while being, on
  // paper, correctly placed above its marker.
  const above = anchorY - CARD_GAP - cardH;
  if (above >= min) return Math.min(above, max);
  // No room above — sit below and clamp, which is the only case where the card
  // and its pin can end up on the same part of the screen.
  return Math.min(Math.max(anchorY + CARD_GAP, min), max);
}

export function previewCardWidth(containerWidth: number): { width: number; narrow: boolean } {
  const narrow = containerWidth < CARD_NARROW;
  // The floor stops the card collapsing to nothing in a container that is
  // briefly zero-width during mount.
  const width = narrow ? Math.max(200, containerWidth - CARD_EDGE * 2) : CARD_W;
  return { width, narrow };
}
