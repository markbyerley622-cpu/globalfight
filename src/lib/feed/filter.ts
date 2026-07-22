// The "brain" of the feed: what counts as a fight, its topic, and intent parsing.
import type { FeedVideo, FeedTopic, FeedFilterOptions } from "./types";
import { deriveTags } from "./tags";

interface TopicDef { id: FeedTopic; label: string; match: string[]; }

export const TOPICS: TopicDef[] = [
  { id: "ufc", label: "UFC / MMA", match: ["ufc", "mma", "dana white", "octagon", "fight night", "ultimate fighting", "bellator", "pfl"] },
  { id: "boxing", label: "Boxing", match: ["boxing", "boxer", "canelo", "tyson fury", "heavyweight", "wba", "wbc", "matchroom", "top rank"] },
  { id: "muaythai", label: "Muay Thai", match: ["muay thai", "muaythai", "clinch", "rajadamnern", "lumpinee"] },
  { id: "bjj", label: "BJJ / Grappling", match: ["bjj", "jiu jitsu", "jiu-jitsu", "grappling", "adcc", "submission only", "gordon ryan", "craig jones", "wrestling"] },
  { id: "kickboxing", label: "Kickboxing", match: ["kickboxing", "glory", "k-1", "k1"] },
  { id: "one", label: "ONE Championship", match: ["one championship", "one fight night", "one fc"] },
];

const TOPIC_IDS = new Set<string>(TOPICS.map((t) => t.id));

const FIGHT_SIGNALS = [
  "fight", "full fight", "knockout", "ko", "tko", "submission", "finish",
  "highlights", "vs", " v ", "round", "champion", "title", "bout", "brawl",
  "sparring", "technique", "instructional", "walkoff", "flying knee", "takedown",
];

const NOISE: Record<string, string[]> = {
  podcasts: ["podcast", "full episode", "ep.", "episode", "interview", "sit down"],
  drama: ["beef", "callout", "slams", "reacts", "responds", "clap back", "drama", "trash talk", "twitter"],
  press: ["press conference", "presser", "weigh-in", "weigh in", "faceoff", "face off", "media day"],
};

const hay = (v: FeedVideo) => `${v.title} ${v.description || ""} ${v.channel || ""}`.toLowerCase();

// A trusted channel's declared discipline, expressed in the legacy topic
// vocabulary. Only used as a FALLBACK: keyword classification still wins, so a
// Muay Thai bout on ONE's channel is still tagged muaythai rather than being
// flattened to the channel default.
const TOPIC_FOR_DISCIPLINE: Record<string, FeedTopic> = {
  mma: "ufc",
  boxing: "boxing",
  "muay-thai": "muaythai",
  kickboxing: "kickboxing",
  bjj: "bjj",
  wrestling: "bjj",
  "bare-knuckle": "ufc",
};

export function classify(video: FeedVideo): FeedTopic | null {
  if (video.topic && TOPIC_IDS.has(video.topic)) return video.topic;
  const text = hay(video);
  for (const t of TOPICS) if (t.match.some((k) => text.includes(k))) return t.id;
  // Nothing matched the text — but if an ALLOW-LISTED channel published it we
  // already know the discipline, and dropping an official promotion upload
  // because its title lacked a keyword is how the catalog goes quiet on the
  // exact days it should be loudest.
  return (video.discipline && TOPIC_FOR_DISCIPLINE[video.discipline]) || null;
}

export function isFight(video: FeedVideo): boolean {
  const text = hay(video);
  return FIGHT_SIGNALS.some((s) => text.includes(s));
}

function durationSeconds(v: FeedVideo): number | null {
  if (typeof v.durationSeconds === "number") return v.durationSeconds;
  if (!v.duration) return null;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(v.duration);
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

// ---- Natural-language intent ----
interface Phrase { p: string; tag?: string; topic?: FeedTopic; word?: boolean; }
const PHRASES: Phrase[] = [
  { p: "full fight", tag: "fullfight" },
  { p: "muay thai", topic: "muaythai" },
  { p: "jiu jitsu", topic: "bjj" }, { p: "jiu-jitsu", topic: "bjj" },
  { p: "one championship", topic: "one" },
  { p: "ground game", tag: "grappling" },
  { p: "how to", tag: "instructional" },
  { p: "knockout", tag: "ko" }, { p: "finishes", tag: "ko" }, { p: "finish", tag: "ko" },
  { p: "submission", tag: "submission" }, { p: "tapout", tag: "submission" },
  { p: "striking", tag: "striking" }, { p: "stand up", tag: "striking" }, { p: "standup", tag: "striking" },
  { p: "grappling", tag: "grappling" }, { p: "ground", tag: "grappling" },
  { p: "instructional", tag: "instructional" }, { p: "technique", tag: "instructional" },
  { p: "tutorial", tag: "instructional" }, { p: "breakdown", tag: "instructional" },
  { p: "highlight", tag: "highlights" },
  { p: "training", tag: "training" }, { p: "sparring", tag: "training" },
  { p: "promo", tag: "promo" }, { p: "preview", tag: "promo" }, { p: "trailer", tag: "promo" },
  { p: "interview", tag: "interview" }, { p: "podcast", tag: "interview" },
  { p: "drama", tag: "interview" }, { p: "press", tag: "interview" }, { p: "callout", tag: "interview" },
  { p: "boxing", topic: "boxing" }, { p: "kickboxing", topic: "kickboxing" },
  { p: "wrestling", tag: "grappling" },
  { p: "kos", tag: "ko", word: true }, { p: "ko", tag: "ko", word: true },
  { p: "subs", tag: "submission", word: true },
  { p: "bjj", topic: "bjj", word: true }, { p: "ufc", topic: "ufc", word: true },
  { p: "mma", tag: "mma", word: true }, { p: "one", topic: "one", word: true },
];
const NEG = /\b(no|not|without|hide|exclude|remove|except|skip|avoid)\b/;

export interface Intent {
  includeTags: Set<string>; excludeTags: Set<string>;
  includeTopics: Set<string>; excludeTopics: Set<string>;
}

export function parseIntent(text: string): Intent {
  const includeTags = new Set<string>(), excludeTags = new Set<string>();
  const includeTopics = new Set<string>(), excludeTopics = new Set<string>();
  const clauses = String(text).toLowerCase().split(/[,;]|\band\b|\bbut\b|\bplus\b/);
  for (const clause of clauses) {
    const negative = NEG.test(clause);
    for (const e of PHRASES) {
      const hit = e.word ? new RegExp(`\\b${e.p}\\b`).test(clause) : clause.includes(e.p);
      if (!hit) continue;
      if (e.tag) (negative ? excludeTags : includeTags).add(e.tag);
      if (e.topic) (negative ? excludeTopics : includeTopics).add(e.topic);
    }
  }
  return { includeTags, excludeTags, includeTopics, excludeTopics };
}

// Returns videos with `topic` and `tags` populated.
export function filterFeed(videos: FeedVideo[], options: FeedFilterOptions = {}): FeedVideo[] {
  const topics = options.topics && options.topics.length ? new Set(options.topics) : null;
  const hide = new Set(options.hide || []);
  const minSeconds = options.minSeconds || 0;
  const q = (options.q || "").trim().toLowerCase();
  const intent = options.intent ? parseIntent(options.intent) : null;

  return videos
    .map((v) => {
      const topic = classify(v);
      return { ...v, topic, tags: deriveTags({ ...v, topic }) };
    })
    .filter((v) => {
      if (!v.topic) return false;
      if (!isFight(v)) return false;
      if (topics && !topics.has(v.topic)) return false;
      if (intent) {
        if (intent.includeTopics.size && !intent.includeTopics.has(v.topic)) return false;
        if (intent.excludeTopics.has(v.topic)) return false;
        for (const t of intent.includeTags) if (!v.tags!.includes(t)) return false;
        for (const t of intent.excludeTags) if (v.tags!.includes(t)) return false;
      }
      if (q && !hay(v).includes(q)) return false;
      const secs = durationSeconds(v);
      if (minSeconds && secs != null && secs < minSeconds) return false;
      const text = hay(v);
      for (const key of hide) {
        const words = NOISE[key];
        if (words && words.some((w) => text.includes(w))) return false;
      }
      return true;
    });
}
