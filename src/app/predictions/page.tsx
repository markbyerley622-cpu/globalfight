import type { Metadata } from "next";
import { PredictionsMarkets } from "@/components/predictions/predictions-markets";
import { flags } from "@/lib/feature-flags";
import { FeatureUnavailable } from "@/components/feature-unavailable";

export const metadata: Metadata = {
  title: "Predictions",
  description:
    "Prediction markets — predict fight outcomes, climb the leaderboard and earn bragging rights. Free to play, no real money involved.",
  alternates: { canonical: "/predictions" },
};

export default function PredictionsPage() {

  // Disabled for the public launch. The route itself refuses — hiding the nav
  // entry is not a control.
  if (!flags().marketPricesEnabled) {
    return <FeatureUnavailable title="Predictions" reason="Prediction-market prices are not available. Market data from third-party trading venues is disabled pending licensing and regulatory review." />;
  }
  return <PredictionsMarkets />;
}
