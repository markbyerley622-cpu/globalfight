import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { ComingSoon } from "@/components/coming-soon";
import { flags } from "@/lib/feature-flags";
import { FeatureUnavailable } from "@/components/feature-unavailable";

export const metadata: Metadata = {
  title: "Combat Predictions",
  description: "Community and model-driven fight predictions across all combat sports.",
};

export default function CombatPredictionsPage() {

  // Disabled for the public launch. The route itself refuses — hiding the nav
  // entry is not a control.
  if (!flags().marketPricesEnabled) {
    return <FeatureUnavailable title="Predictions" reason="Prediction-market prices are not available. Market data from third-party trading venues is disabled pending licensing and regulatory review." />;
  }
  return (
    <>
      <PageHero
        eyebrow="Combat"
        title="Combat Predictions"
        description="Community picks and model-driven forecasts for upcoming fights — win probabilities, method-of-victory and round projections, tracked for accuracy over time."
      />
      <ComingSoon
        points={[
          "Per-fight win probabilities blending community consensus and statistical models.",
          "Track your prediction accuracy and climb the forecaster leaderboard.",
          "Method and round projections built on canonical fight history.",
        ]}
      />
    </>
  );
}
