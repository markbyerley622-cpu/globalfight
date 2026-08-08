import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  eventCardLayout, scrimIsJustified, EVENT_CARD_VARIANTS,
  previewCardWidth, CARD_W, CARD_EDGE, CARD_NARROW,
} from "../event-card-layout";

// ════════════════════════════════════════════════════════════════════════════
//  THE MOBILE MAP CARD.
//
//  ── What went wrong, precisely ────────────────────────────────────────────
//  The compact layout cropped the hero to a short banner but kept two things
//  that only make sense on a TALL hero: the event title overlaid on the poster,
//  and a top-to-bottom legibility scrim. On a ~140px hero that scrim — tuned
//  for a 220px one — darkened nearly the whole image, and the overlaid title
//  block ate a third of what was left. The poster read as a murky grey band,
//  and every fact under it started lower down the card than it needed to.
//
//  No single class was wrong. The COMBINATION was, and a combination spread
//  across seven `tight ? … : …` call sites is not something review catches.
//
//  ── Why these tests are not Tailwind string assertions ────────────────────
//  There is no DOM test runner in this repository, so rendering the component
//  is not available. Grepping the JSX for class names would be brittle and
//  would test the spelling of a utility rather than the decision behind it.
//
//  Instead the DECISIONS were extracted into a pure module, and this asserts
//  the relationships between them. That is the thing that was actually broken,
//  it holds for variants that do not exist yet, and it cannot be satisfied by
//  renaming a class.
// ════════════════════════════════════════════════════════════════════════════

describe("the scrim invariant — the bug, stated once", () => {
  test("EVERY variant justifies its scrim", () => {
    // A full-height scrim is a cost paid for a benefit: it darkens the whole
    // poster so text sitting ON the poster stays readable. A card with no text
    // on its hero pays that cost for nothing.
    for (const variant of EVENT_CARD_VARIANTS) {
      const layout = eventCardLayout(variant);
      assert.ok(
        scrimIsJustified(layout),
        `"${variant}" draws a FULL scrim over its poster but puts no text on it. ` +
          "Either move the title into the hero, or shorten the scrim.",
      );
    }
  });

  test("the invariant is not vacuous — it rejects the combination that shipped", () => {
    // The exact shape of the bug: a compact hero, no overlaid title, full
    // scrim. If this passed, the check above would be proving nothing.
    const broken = { ...eventCardLayout("compact"), scrim: "full" as const };
    assert.equal(scrimIsJustified(broken), false);
  });

  test("a full scrim IS justified when the hero carries the title", () => {
    const desktop = eventCardLayout("floating");
    assert.equal(desktop.titleInHero, true);
    assert.equal(desktop.scrim, "full");
    assert.ok(scrimIsJustified(desktop));
  });
});

describe("the compact (phone) card", () => {
  const compact = eventCardLayout("compact");

  test("the title is in NORMAL FLOW, not layered on the poster", () => {
    // The change that fixes the card. Nothing is drawn over the poster except
    // the badges, which carry their own backgrounds.
    assert.equal(compact.titleInHero, false);
  });

  test("the scrim is a short foot, never the whole hero", () => {
    assert.equal(compact.scrim, "bottom");
    assert.notEqual(compact.scrim, "full");
  });

  test("the hero is SHORTER than the desktop hero", () => {
    // Expressed as a ratio comparison rather than a class-string match, so this
    // survives a change of aspect and still tests the intent.
    const ratio = (aspect: string) => {
      const [, w, h] = aspect.match(/aspect-\[([\d.]+)\/([\d.]+)\]/) ?? [];
      return Number(w) / Number(h);
    };
    assert.ok(
      ratio(compact.heroAspect) > ratio(eventCardLayout("floating").heroAspect),
      "the phone hero is not shorter than the desktop one",
    );
  });

  test("secondary detail is dropped so the primary facts stay above the fold", () => {
    // Priority order on a phone: promotion → title → countdown → main event →
    // venue → actions. The stat row and the duplicate date line are what give
    // way, because the countdown already answers "when".
    assert.equal(compact.showStats, false);
    assert.equal(compact.showDateLine, false);
    assert.equal(compact.compactCountdown, true);
  });

  test("its poster is not requested at desktop width", () => {
    assert.notEqual(compact.imageSizes, eventCardLayout("floating").imageSizes);
  });
});

describe("desktop has not regressed", () => {
  test("the anchored desktop card keeps its overlaid title and full treatment", () => {
    const floating = eventCardLayout("floating");
    assert.equal(floating.titleInHero, true);
    assert.equal(floating.scrim, "full");
    assert.equal(floating.heroAspect, "aspect-[16/9]");
    assert.equal(floating.showStats, true);
    assert.equal(floating.showDateLine, true);
  });

  test("the bottom sheet keeps the largest treatment of all", () => {
    const sheet = eventCardLayout("sheet");
    assert.equal(sheet.titleInHero, true);
    assert.equal(sheet.compactCountdown, false, "the sheet lost its full-size countdown");
    assert.equal(sheet.titleSize, "text-base");
  });
});

describe("every variant is complete", () => {
  test("no variant is missing a field a renderer will read", () => {
    for (const variant of EVENT_CARD_VARIANTS) {
      const l = eventCardLayout(variant);
      for (const key of ["heroAspect", "contentSpacing", "titleSize", "imageSizes"] as const) {
        assert.ok(l[key] && l[key].length > 0, `${variant} has no ${key}`);
      }
      assert.ok(["none", "bottom", "full"].includes(l.scrim), `${variant} has an unknown scrim`);
    }
  });

  test("an unknown variant falls back rather than rendering nothing", () => {
    // A card that rendered with undefined classes would be an invisible box.
    const fallback = eventCardLayout("nonsense" as never);
    assert.equal(fallback.heroAspect, eventCardLayout("sheet").heroAspect);
  });
});

describe("the card fits real devices, including the smallest", () => {
  /**
   * Viewport → the width of the map box the card is drawn inside.
   *
   * The map is `mx-4`, so it loses 16px of gutter each side. These are the
   * devices the card actually has to survive; 320px is the one that matters and
   * the one nobody has to hand.
   */
  const DEVICES = [320, 360, 375, 390, 430];
  const mapBox = (viewport: number) => viewport - 32;

  for (const viewport of DEVICES) {
    test(`${viewport}px — the card fits inside the map with margins`, () => {
      const container = mapBox(viewport);
      const { width } = previewCardWidth(container);

      // The invariant that matters on every device: the card never exceeds the
      // box it is drawn in. Which BRANCH produces that is an implementation
      // detail — a 430px phone leaves a 398px map, which is genuinely wide
      // enough for the full 340px card beside a pin, so it takes the desktop
      // path and is correct to.
      assert.ok(
        width <= container - CARD_EDGE,
        `the card (${width}px) does not clear the container (${container}px) at ${viewport}px`,
      );
      // Wide enough for a three-cell countdown and a two-name main-event row.
      // Below roughly this, the bout names truncate to nothing useful.
      assert.ok(width >= 240, `the card is only ${width}px wide at ${viewport}px`);
    });
  }

  test("the small phones take the NARROW layout", () => {
    // Where the card cannot sit beside a pin it goes above it and shrinks to
    // fit — see FloatingPreview. These are the widths that must take that path.
    for (const viewport of [320, 360, 375, 390]) {
      assert.equal(
        previewCardWidth(mapBox(viewport)).narrow, true,
        `${viewport}px should use the narrow layout`,
      );
    }
  });

  test("a desktop container keeps the full-width card", () => {
    const { width, narrow } = previewCardWidth(1200);
    assert.equal(narrow, false);
    assert.equal(width, CARD_W, "desktop lost its fixed card width");
  });

  test("the narrow threshold is where a card no longer fits BESIDE a pin", () => {
    // Just under, and the layout must switch; just over, and it must not.
    assert.equal(previewCardWidth(CARD_NARROW - 1).narrow, true);
    assert.equal(previewCardWidth(CARD_NARROW).narrow, false);
  });

  test("a zero-width container does not collapse the card to nothing", () => {
    // Containers measure zero for a frame during mount.
    assert.ok(previewCardWidth(0).width >= 200);
  });
});

// ── The one thing only the source can tell us ───────────────────────────────

describe("the card's structure", () => {
  const SRC = join(process.cwd(), "src");
  const source = readFileSync(join(SRC, "components/map/event-map-preview.tsx"), "utf8");

  test("no gradient is layered over the whole CARD", () => {
    // The scrim must be a child of the hero. An `absolute inset-0` gradient
    // that is a sibling of the hero would cover the countdown, the main event
    // and the actions — which is what the card looked like it was doing.
    //
    // Asserted by counting: the only absolutely-positioned full-bleed gradient
    // in this file belongs to the hero, and it is now conditional.
    const fullBleedGradients = source.match(/absolute inset-0[^"]*gradient/g) ?? [];
    assert.deepEqual(
      fullBleedGradients, [],
      "an `absolute inset-0` gradient exists. The scrim is bounded to the hero " +
        "by `inset-x-0 bottom-0` plus a top/height, so a full-bleed one is " +
        "either a regression or a second overlay.",
    );
  });

  test("the layout decisions all come from the shared module", () => {
    // If a `tight ?` ternary reappears, the invariant above stops covering the
    // thing it is meant to cover.
    assert.ok(source.includes("eventCardLayout("), "the card no longer uses the layout module");
    assert.ok(
      !/\btight\s*\?/.test(source),
      "a per-variant ternary is back in the component — move it into event-card-layout",
    );
  });

  test("the decorative scrim stays hidden from screen readers", () => {
    assert.ok(source.includes("aria-hidden"), "the scrim lost its aria-hidden");
  });
});
