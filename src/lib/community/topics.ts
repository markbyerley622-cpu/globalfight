// Client- and server-safe (no server-only imports). Feed topic → community slug:
// the suggested default when starting a video discussion. The creator can always
// pick another community.
const TOPIC_TO_COMMUNITY: Record<string, string> = {
  ufc: "mma", mma: "mma", one: "mma",
  boxing: "boxing", muaythai: "muay-thai", "muay-thai": "muay-thai",
  bjj: "bjj", kickboxing: "kickboxing", wrestling: "wrestling",
};

export function suggestedCommunitySlug(topic?: string | null): string {
  return (topic && TOPIC_TO_COMMUNITY[topic]) || "general";
}
