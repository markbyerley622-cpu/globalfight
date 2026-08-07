import Link from "next/link";
import { TRUST } from "./content";
import { Reveal } from "./reveal";

/**
 * Legitimacy, in three short claims and four links.
 *
 * Every sentence here is one the product can defend. What is deliberately
 * ABSENT matters as much as what is present: no accuracy guarantee (the data
 * comes from public sources and those sources are sometimes wrong), no claim of
 * official affiliation with any promotion or sanctioning body, no certification
 * badge, no "trusted by" logo wall. A trust section that overclaims is the
 * fastest way to become untrustworthy.
 *
 * The four links are the real legal surfaces. They are the proof of the three
 * claims above them, which is why they sit in this section rather than only in
 * the footer.
 */
export function TrustPrinciples() {
  return (
    <section className="hl-section hl-trust" aria-labelledby="hl-trust-heading">
      <div className="container-cr">
        <Reveal as="header" className="hl-section-head">
          <h2 id="hl-trust-heading" className="hl-h2">
            {TRUST.headline}
          </h2>
        </Reveal>

        <ul className="hl-principles">
          {TRUST.principles.map((p, i) => (
            <Reveal key={p.id} as="li" delay={i * 70} className="hl-principle">
              <h3 className="hl-principle-title">{p.title}</h3>
              <p className="hl-principle-copy">{p.copy}</p>
            </Reveal>
          ))}
        </ul>

        <Reveal className="hl-trust-links">
          {TRUST.links.map((l) => (
            <Link key={l.href} href={l.href} className="hl-quiet-link">
              {l.label}
            </Link>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
