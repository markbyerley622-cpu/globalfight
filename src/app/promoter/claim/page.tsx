import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getViewerPromoter } from "@/lib/promoter/repo";
import { PageHero } from "@/components/page-hero";
import { ClaimForm } from "@/components/promoter/claim-form";

export const metadata: Metadata = {
  title: "Claim your promotion",
  robots: { index: false, follow: false },
};

export default async function PromoterClaimPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/account?returnTo=${encodeURIComponent("/promoter/claim")}`);

  // Already applied or already verified — the promoter home is the right place
  // for both, and it shows the state. Applying twice from a stale tab should
  // not create a second application.
  const promoter = await getViewerPromoter(user.id);
  if (promoter) redirect("/promoter");

  return (
    <>
      <PageHero
        eyebrow="Promoters"
        title="Claim your promotion"
        description="Tell us who you are and we'll verify you. Once you're approved you can publish cards straight from a poster."
      />
      <div className="container-cr max-w-2xl py-6">
        <ClaimForm />
      </div>
    </>
  );
}

export const dynamic = "force-dynamic";
