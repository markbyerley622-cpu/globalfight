import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = {
  title: "Combat Profiles",
  description: "Verified, source-backed athlete profiles across every combat discipline.",
};

export default function CombatProfilesPage() {
  return (
    <>
      <PageHero
        eyebrow="Combat"
        title="Combat Profiles"
        description="Verified, source-backed athlete profiles — records, rankings, fight history and media — unified from every promotion into one canonical identity."
      />
      <ComingSoon
        points={[
          "One canonical profile per fighter, merged across MMA, boxing, kickboxing, Muay Thai and bare-knuckle.",
          "Records and rankings cross-checked against multiple data providers.",
          "Claimed profiles for athletes, gyms and management teams.",
        ]}
      />
    </>
  );
}
