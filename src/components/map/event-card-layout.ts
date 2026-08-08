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
export function previewCardWidth(containerWidth: number): { width: number; narrow: boolean } {
  const narrow = containerWidth < CARD_NARROW;
  // The floor stops the card collapsing to nothing in a container that is
  // briefly zero-width during mount.
  const width = narrow ? Math.max(200, containerWidth - CARD_EDGE * 2) : CARD_W;
  return { width, narrow };
}
