// Content intelligence: derive rich tags and a smart ranking score. Pure
// keyword/semantics over title+description — no external AI.
import type { FeedVideo, FeedTopic } from "./types";

const TAG_RULES: Record<string, string[]> = {
  striking: ["strik", "knockout", " ko", "ko ", "punch", "head kick", "body kick", "elbow", "boxing", "boxer", "jab", "hook", "uppercut", "combo", "muay thai", "kickbox"],
  grappling: ["grappl", "jiu jitsu", "jiu-jitsu", "bjj", "submission", "choke", "armbar", "heel hook", "leg lock", "guard pass", "back take", "rear naked", "adcc", "wrestl", "takedown", " ground and pound", " ground game"],
  mma: ["mma", "ufc", "octagon", "one championship", "bellator", "pfl", "mixed martial"],
  ko: ["knockout", "knockouts", " ko", "ko ", "tko", "finish", "finishes", "flatline", "walk-off", "walkoff", "brutal", "vicious", "head kick ko"],
  submission: ["submission", "submissions", " sub ", "tap out", "tapout", "taps out", "refused to tap", "choke", "armbar", "kimura", "heel hook", "leg lock", "guillotine", "rear naked", "triangle"],
  fullfight: ["full fight", "full fights", "complete fight"],
  highlights: ["highlight", "highlights", "top 10", "top10", "best of", "top finishes", "greatest", "best moments", "savage moments"],
  instructional: ["instructional", "technique", "how to", "tutorial", "breakdown", "break down", "learn", "drill", "step by step", "masterclass", "system"],
  training: ["training", "camp", "sparring", "spar", "workout", "mitts", "heavy bag", "prep", "road to"],
  promo: ["promo", "preview", "trailer", "countdown", "embedded", "road to", "teaser", "announce", "first look"],
  interview: ["interview", "reacts", "responds", "podcast", "sit down", "press conference", "presser", "weigh-in", "weigh in", "faceoff", "face off", "beef", "callout", "trash talk"],
};

const TOPIC_TAGS: Record<string, string[]> = {
  boxing: ["striking"],
  muaythai: ["striking"],
  kickboxing: ["striking"],
  bjj: ["grappling"],
  ufc: ["mma"],
  one: ["mma"],
};

export const TOPIC_LABEL: Record<string, string> = {
  ufc: "UFC / MMA", boxing: "Boxing", muaythai: "Muay Thai",
  bjj: "BJJ", kickboxing: "Kickboxing", one: "ONE",
};

export function deriveTags(video: FeedVideo): string[] {
  const text = `${video.title || ""} ${video.description || ""}`.toLowerCase();
  const tags = new Set<string>(TOPIC_TAGS[video.topic ?? ""] || []);
  for (const [tag, kws] of Object.entries(TAG_RULES)) {
    if (kws.some((k) => text.includes(k))) tags.add(tag);
  }
  if (tags.has("ko")) tags.add("striking");
  if (tags.has("submission")) tags.add("grappling");
  return [...tags];
}

// Blend popularity (views), freshness and content quality.
export function smartScore(video: FeedVideo, now: number): number {
  const views = video.viewCount || 0;
  let score = Math.log10(views + 10);
  const days = video.publishedAt ? (now - new Date(video.publishedAt).getTime()) / 86400000 : 999;
  score += days <= 7 ? 1.2 : days <= 30 ? 0.8 : days <= 90 ? 0.4 : days <= 365 ? 0 : -0.5;
  const tags = video.tags || deriveTags(video);
  if (tags.some((t) => ["ko", "submission", "fullfight", "highlights"].includes(t))) score += 0.5;
  if (tags.includes("instructional")) score += 0.3;
  if (tags.includes("promo") || tags.includes("interview")) score -= 1.0;
  return score;
}

// Surface the single most interesting content tag on a card/overlay.
const PILL: Record<string, [string, boolean]> = {
  ko: ["Knockout", true], submission: ["Submission", true], fullfight: ["Full Fight", true],
  instructional: ["Technique", false], highlights: ["Highlights", false],
};
export function contentPill(tags: string[] = []): [string, boolean] | null {
  for (const t of ["ko", "submission", "fullfight", "instructional", "highlights"]) {
    if (tags.includes(t)) return PILL[t];
  }
  return null;
}

export const TOPICS_META: { id: FeedTopic; label: string }[] = [
  { id: "ufc", label: "UFC / MMA" },
  { id: "boxing", label: "Boxing" },
  { id: "muaythai", label: "Muay Thai" },
  { id: "bjj", label: "BJJ / Grappling" },
  { id: "kickboxing", label: "Kickboxing" },
  { id: "one", label: "ONE" },
];
