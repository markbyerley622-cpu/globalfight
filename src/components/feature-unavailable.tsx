import { Lock } from "lucide-react";
import { PageHero } from "@/components/page-hero";

/**
 * Shown where a feature is switched off for the public launch.
 *
 * Deliberately honest: it says the feature is unavailable and why, rather than
 * showing an empty state that reads like "no data yet". It is NOT populated with
 * stale or placeholder content — a fabricated ranking is worse than no ranking.
 */
export function FeatureUnavailable({
  title,
  reason,
}: {
  title: string;
  reason: string;
}) {
  return (
    <>
      <PageHero eyebrow="Unavailable" title={title} />
      <div className="container-cr py-20 text-center">
        <Lock className="mx-auto mb-4 size-10 text-ink-600" />
        <p className="mx-auto max-w-prose text-sm text-mist">{reason}</p>
      </div>
    </>
  );
}
