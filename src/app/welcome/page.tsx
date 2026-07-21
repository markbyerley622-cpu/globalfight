import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getOnboardingState } from "@/lib/onboarding";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export const metadata: Metadata = {
  title: "Welcome",
  description: "Set up your Combat Reviews feed in under a minute.",
  robots: { index: false },
};

/**
 * First run. Re-entrant by design — a user can come back from their profile to
 * change what they follow, and the flow loads with their current selection
 * rather than starting from nothing.
 */
export default async function WelcomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/account?next=/welcome");
  const state = await getOnboardingState(user.id);
  return <OnboardingFlow initial={{ role: state.role, sports: state.sports, promotions: state.promotions, fighters: state.fighters }} />;
}

export const dynamic = "force-dynamic";
