import { CTA, FINAL, ROUTES } from "./content";
import { PrimaryCta, SecondaryCta } from "./cta";
import { Reveal } from "./reveal";
import type { LandingData } from "./data";

/**
 * The last slide. One statement, one action, and nothing underneath it.
 *
 * The wordmark sits behind an event-to-result timeline built from the same card
 * the whole page has been following, which is the argument made once more in one
 * line: this product takes a fight from announcement to record. It is decorative
 * and marked as such — the reader has already been told this four times in the
 * story, and a fifth reading is noise.
 */
export function FinalSignupCta({ data }: { data: LandingData }) {
  const { hero, result } = data;

  const timeline = [
    hero.placeholder ? "Announced" : hero.name,
    "Full card",
    "Your call",
    result ? `${result.winner} · ${result.outcome}` : "Official result",
  ];

  return (
    <section className="hl-section hl-final" aria-labelledby="hl-final-heading">
      <span className="hl-final-mark" aria-hidden="true">
        Combat Reviews
      </span>

      <div className="container-cr hl-final-inner">
        <Reveal>
          <h2 id="hl-final-heading" className="hl-final-headline">
            {FINAL.headline}
          </h2>
          <p className="hl-final-support">{FINAL.support}</p>

          <div className="hl-actions hl-actions-center">
            <PrimaryCta position="final" />
            <SecondaryCta position="final" label={CTA.secondaryLong} href={ROUTES.events} />
          </div>

          <p className="hl-micro">{FINAL.reassurance}</p>
        </Reveal>

        <Reveal className="hl-final-timeline" aria-hidden="true">
          {timeline.map((step, i) => (
            <span key={`${step}-${i}`} className="hl-final-step">
              {step}
            </span>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
