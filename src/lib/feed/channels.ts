// Curated combat-sports channels for zero-quota RSS ingestion.
// Add more freely — the ingestion job picks them up on the next refresh.
import type { FeedTopic } from "./types";

export interface FeedChannel {
  topic: FeedTopic;
  id?: string; // modern channel_id
  user?: string; // legacy username
}

export const CHANNELS: FeedChannel[] = [
  // MMA
  { topic: "ufc", id: "UCvgfXK4nTYKudb0rFR6noLA" }, // UFC
  { topic: "ufc", user: "BellatorMMA" }, // Bellator MMA
  { topic: "ufc", id: "UCLoz0Yo1tP91ZUhe3CSTZIw" }, // SevereMMA
  { topic: "ufc", id: "UChUf04XP1CU_5llHA-0Ik5A" }, // MiddleEasy
  { topic: "ufc", id: "UCxQfUu6vIJGZDODSwhr0m9w" }, // MMA Junkie
  { topic: "ufc", id: "UC789h3eqw0H1HqGmIsI26OA" }, // TheMacLife
  // ONE (MMA / Muay Thai / kickboxing)
  { topic: "one", id: "UCiormkBf3jm6mfb7k0yPbKA" }, // ONE Championship
  // Boxing
  { topic: "boxing", user: "trboxing" }, // Top Rank Boxing
  { topic: "boxing", id: "UC7LReVje9aPB4B6XAsXX8WQ" }, // Matchroom Boxing
  { topic: "boxing", id: "UCdl_gZZR6BtKi45eHFGAduw" }, // iFL TV
  { topic: "boxing", id: "UCAzXqFoW1Y7KDqwZ1x5m9EA" }, // Fight Commentary Breakdowns
  // BJJ / grappling / wrestling
  { topic: "bjj", id: "UCeOvhU6RbmEj8GKFiIMWxKQ" }, // FloGrappling
  { topic: "bjj", id: "UCtXtqlLdZYZm3060qVExXkA" }, // Bernardo Faria BJJ
  { topic: "bjj", id: "UC0OFPvrlWV-FiAVIYjBHkQg" }, // FloWrestling
];

const FEED = "https://www.youtube.com/feeds/videos.xml";
export const channelUrl = (c: FeedChannel): string =>
  c.id ? `${FEED}?channel_id=${c.id}` : `${FEED}?user=${c.user}`;
