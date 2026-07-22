import { LegalPage, H2 } from "@/components/legal/legal-page";
import { flags } from "@/lib/feature-flags";

export const metadata = { title: "Responsible Gambling" };
export const dynamic = "force-dynamic";

/**
 * This page exists even though market data is DISABLED, for two reasons: the footer
 * must not have a dead link, and it states plainly that we do not facilitate betting —
 * which is the honest position while the feature is off.
 *
 * The 18+ and responsible-gambling controls below are the ones that must be live BEFORE
 * MARKET_PRICES_ENABLED is ever turned on. They are documented here, not hidden.
 */
export default function ResponsibleGamblingPage() {
  const marketsOn = flags().marketPricesEnabled;

  return (
    <LegalPage title="Responsible Gambling" intro="Where we stand on betting and prediction markets.">
      <H2>We do not facilitate betting</H2>
      <p>
        Combat Reviews is an information and community platform. <b>We are not a bookmaker, we are
        not a trading venue, and we do not take or place bets.</b>
      </p>

      {!marketsOn ? (
        <>
          <p>
            Prediction-market prices and betting odds are <b>not displayed on this site</b>, and we
            do not link out to prediction-market or gambling venues. That functionality is switched
            off pending licensing and regulatory review.
          </p>
          <p className="text-fog">
            If that changes, this page will change with it, and the controls below will be in place
            before any price is shown.
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-4">
          <p className="font-semibold text-chalk">18+ only. Any market data shown here is for information only.</p>
          <p className="mt-2">
            Prices shown are third-party market data, not an offer to bet, and not a prediction of
            what will happen. Nothing here is advice, and nothing here suggests you can make money.
          </p>
        </div>
      )}

      <H2>If gambling is causing you harm</H2>
      <p>Free, confidential help is available. You do not have to be in crisis to use it.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li><b>GamCare</b> — 0808 8020 133, 24 hours a day. gamcare.org.uk</li>
        <li><b>BeGambleAware</b> — begambleaware.org</li>
        <li><b>GAMSTOP</b> — self-exclude from UK-licensed gambling sites. gamstop.co.uk</li>
        <li><b>Gordon Moody</b> — residential and online treatment. gordonmoody.org.uk</li>
      </ul>

      <H2>Age</H2>
      <p>
        You must be 18 or over to view betting or prediction-market content anywhere. Combat Reviews
        requires you to be at least 16 to hold an account, and does not show market content at all.
      </p>
    </LegalPage>
  );
}
