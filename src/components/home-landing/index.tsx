import "./home-landing.css";

import { JsonLd } from "@/components/seo/json-ld";
import { SITE } from "@/lib/config";
import { META } from "./content";
import { getLandingData } from "./data";
import { LandingHero } from "./hero";
import { FightJourneyStory } from "./story";
import { ProductEcosystem } from "./ecosystem";
import { PersonalisedExperience } from "./personalisation";
import { TrustPrinciples } from "./trust";
import { FinalSignupCta } from "./final-cta";
import { LandingView } from "./reveal";

/**
 * The public landing page at `/`.
 *
 * Seven sections in one server component. Only four things on this page are
 * client code, and each one is a genuine interaction rather than a decoration:
 * the nav's scrolled state (in the shell), the scroll narrative, the reveal
 * observer, and the CTA click handlers. Everything else — every headline, every
 * product preview, every real row from the database — is in the server HTML, so
 * the page is complete before a single byte of JavaScript arrives and complete
 * forever if it never does.
 *
 * The structured data describes the ORGANISATION and the SITE, and nothing else.
 * No aggregate rating, no review count, no event count, no `Event` markup for
 * cards we do not own — every one of those is a rich-result claim that would
 * have to be true and defensible, and two of them would be neither.
 */
export async function HomeLandingPage() {
  const data = await getLandingData();

  return (
    <div className="hl">
      <LandingView />

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE.url}#organization`,
              name: SITE.name,
              url: SITE.url,
              logo: `${SITE.url}/cr-logo.png`,
              description: META.description,
            },
            {
              "@type": "WebSite",
              "@id": `${SITE.url}#website`,
              url: SITE.url,
              name: SITE.name,
              description: META.description,
              publisher: { "@id": `${SITE.url}#organization` },
            },
          ],
        }}
      />

      <LandingHero event={data.hero} upNext={data.upNext} />

      <FightJourneyStory
        data={{
          event: data.hero,
          upNext: data.upNext,
          result: data.result,
          coverage: data.coverage,
          leaders: data.leaders,
        }}
      />

      <ProductEcosystem data={data} />
      <PersonalisedExperience data={data} />
      <TrustPrinciples />
      <FinalSignupCta data={data} />
    </div>
  );
}
