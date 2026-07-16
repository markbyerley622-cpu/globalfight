import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = {
  title: "Combat Contracts",
  description: "Transparent fighter contracts, bout agreements and matchmaking on the registry.",
};

export default function CombatContractsPage() {
  return (
    <>
      <PageHero
        eyebrow="Combat"
        title="Combat Contracts"
        description="A transparent layer for bout agreements and matchmaking — connecting fighters, managers and promoters with verified profiles and source-backed records."
      />
      <ComingSoon
        points={[
          "Verified bout agreements linked to canonical fighter and event records.",
          "Matchmaking between athletes, managers and promoters across the registry.",
          "A clear, auditable history of offers, signings and fight obligations.",
        ]}
      />
    </>
  );
}
