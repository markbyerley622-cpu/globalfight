import { redirect } from "next/navigation";
import { flags } from "@/lib/feature-flags";
import { FeatureUnavailable } from "@/components/feature-unavailable";

// Champions are now merged into the unified Rankings hub.
export default function ChampionsPage() {

  // Disabled for the public launch. The route itself refuses — hiding the nav
  // entry is not a control.
  if (!flags().rankingsEnabled) {
    return <FeatureUnavailable title="Champions" reason="Rankings are not available. Our existing ranking data could not be traced to a licensed source, so it has been withdrawn. Rankings will return when a licensed source is in place." />;
  }
  redirect("/rankings");
}
