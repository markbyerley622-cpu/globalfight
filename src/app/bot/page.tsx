import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { BOT_USER_AGENT } from "@/lib/http-identity";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: "CombatReviewsBot — about our crawler",
  description: "What CombatReviewsBot is, what it fetches, how often, and how to contact us or block it.",
};

// The page the outbound User-Agent points at.
//
// Every request this application makes carries `+<origin>/bot`. That URL used to
// 404, which made the whole "one honest, identifying User-Agent" policy a claim
// with nothing behind it. This is the something behind it: a site operator who
// sees us in their logs can land here and find out who we are, what we take, and
// how to make us stop — without having to guess or block blindly.
//
// Keep it plain, factual, and free of marketing. Its readers are sysadmins.

const CONTACT = process.env.LEGAL_CONTACT_EMAIL || process.env.PRIVACY_CONTACT_EMAIL || null;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-ink-800 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="font-display text-xs font-bold uppercase tracking-wider text-fog">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-mist sm:col-span-2 sm:mt-0">{children}</dd>
    </div>
  );
}

export default function BotPage() {
  return (
    <>
      <PageHero
        eyebrow="For site operators"
        title="CombatReviewsBot"
        description="The crawler behind this site — what it is, what it fetches, and how to stop it."
      />

      <div className="container-cr py-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm leading-relaxed text-mist">
            If you are reading this, you probably found our User-Agent in your server logs. This page
            tells you everything we can tell you about it. If anything here does not match what you
            are seeing, we would genuinely like to know.
          </p>

          <dl className="mt-8">
            <Row label="User-Agent">
              <code className="break-all rounded bg-ink-900 px-2 py-1 text-xs text-chalk">{BOT_USER_AGENT}</code>
              <p className="mt-2 text-xs text-fog">
                We send exactly this string, from every code path. We do not rotate it, and we do not
                send a browser User-Agent. If a request claiming to be us does either of those things,
                it is not us.
              </p>
            </Row>

            <Row label="What it fetches">
              Publicly reachable pages about combat-sports events, fight cards and results — event
              listings, card pages and the encyclopaedia articles that report their outcomes. It does
              not attempt to reach anything behind a login, a paywall, or a disallow rule.
            </Row>

            <Row label="How often">
              Rarely. Fetches are throttled to roughly one request every few seconds per run, and the
              jobs that make them run hourly at most — most run daily or weekly. A full pass over a
              single site is tens of requests, not thousands.
            </Row>

            <Row label="If you refuse us">
              A 401, 403, 404, 405, 410 or 429 is treated as final. We do not retry it, we do not back
              off and try again later with a different header, and we do not try a different address.
              One refusal stops that fetch.
            </Row>

            <Row label="robots.txt">
              We honour it. To block this crawler specifically, add:
              <pre className="mt-2 overflow-x-auto rounded bg-ink-900 p-3 text-xs text-chalk">{`User-agent: CombatReviewsBot\nDisallow: /`}</pre>
            </Row>

            <Row label="Attribution">
              Where we display material that came from your site, we say so and link back to you.
            </Row>

            <Row label="Contact">
              {CONTACT ? (
                <a href={`mailto:${CONTACT}`} className="text-blood-400 underline decoration-ink-700 underline-offset-2 hover:text-blood-300">
                  {CONTACT}
                </a>
              ) : (
                // Deliberately explicit rather than a fake address: a contact
                // route that does not exist is the failure this page was written
                // to fix, and inventing one here would repeat it.
                <span className="text-fog">
                  No contact address is configured on this deployment. Set <code className="text-mist">LEGAL_CONTACT_EMAIL</code> before
                  running the crawler in production.
                </span>
              )}
              <p className="mt-2 text-xs text-fog">
                Ask us to slow down, to stop, or to remove something, and we will. You do not need to
                explain why.
              </p>
            </Row>

            <Row label="This deployment">
              <code className="break-all text-xs text-chalk">{SITE.url}</code>
            </Row>
          </dl>
        </div>
      </div>
    </>
  );
}
