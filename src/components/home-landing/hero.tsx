import { HERO } from "./content";
import { PrimaryCta, SecondaryCta } from "./cta";
import { HeroEventExperience } from "./hero-event";
import type { HeroEvent, MiniEvent } from "./data";

/**
 * The first screen.
 *
 * Nothing here is revealed on scroll and nothing here waits for JavaScript: the
 * headline, the sentence under it, both CTAs and the whole event card are in the
 * server HTML. The only client code that touches this section is the countdown
 * inside the card, which is a clock and cannot be anything else.
 *
 * The headline is one `h1` split across three lines by markup rather than by
 * luck, because "Every fight. Every fighter. One place." only reads as three
 * beats if it breaks in three places — and a `<br>` would put a line break in
 * the accessible name. Three spans, one heading, one announcement.
 */
export function LandingHero({ event, upNext }: { event: HeroEvent; upNext: MiniEvent[] }) {
  return (
    <section className="hl-hero" aria-labelledby="hl-hero-title">
      <div className="hl-hero-wash" aria-hidden="true" />
      <div className="container-cr hl-hero-grid">
        <div className="hl-hero-copy">
          <span className="hl-eyebrow">{HERO.eyebrow}</span>

          <h1 id="hl-hero-title" className="hl-display">
            {HERO.headline.map((line, i) => (
              <span key={line} className="hl-display-line" data-accent={i === 2 ? "true" : undefined}>
                {line}
              </span>
            ))}
          </h1>

          <p className="hl-lead">{HERO.support}</p>

          <div className="hl-actions">
            <PrimaryCta position="hero" />
            <SecondaryCta position="hero" />
          </div>

          <p className="hl-micro">{HERO.micro}</p>

          {/* The category, stated once. Eight words that tell a boxing fan and a
              judoka the same thing: this is not somebody else's sport's site. */}
          <p className="hl-sports">{HERO.sports}</p>
        </div>

        <HeroEventExperience event={event} upNext={upNext} />
      </div>
    </section>
  );
}
