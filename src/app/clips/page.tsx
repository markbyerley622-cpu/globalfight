import type { Metadata } from "next";
import { ClipsExperience } from "@/components/clips/clips-experience";
import { listClips } from "@/lib/clips/repo";
import { getSessionUserId } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Combat Clips",
  description: "Shorts and full fight videos — upload native clips that autoplay and get rated, or browse the curated video catalog.",
};

export const dynamic = "force-dynamic";

export default async function ClipsPage() {
  const viewerId = (await getSessionUserId()) ?? undefined;
  const { items, nextCursor } = await listClips({ viewerId, limit: 8 });
  return <ClipsExperience initialClips={items} initialCursor={nextCursor} />;
}
