// Cold-start fallback: shown only in the brief window before the first
// ingestion populates the catalog. Real, recent combat videos (harvested from
// the channel RSS) so thumbnails and playback work even before ingest lands.
import type { FeedVideo } from "./types";

export const MOCK_VIDEOS: FeedVideo[] = [
  { id: "gKypmk_mD6Y", title: "LIVE MCGREGOR VS DIAZ 2 | FULL EVENT", channel: "UFC", description: "Full fight highlights and knockouts.", publishedAt: "2026-06-30T21:54:25+00:00", viewCount: 39141, topic: "ufc" },
  { id: "ag5Ps_gAiq4", title: "Behind The Scenes of Fiziev vs Torres | UFC Journey", channel: "UFC", description: "Full fight highlights and knockouts.", publishedAt: "2026-07-03T21:17:04+00:00", viewCount: 14351, topic: "ufc" },
  { id: "H_I1T3KZadI", title: "Boots Ennis TKO Xander Zayas | Behind the Scenes | Matchroom Boxing", channel: "Matchroom Boxing", description: "Full fight highlights and knockouts.", publishedAt: "2026-07-04T18:00:06+00:00", viewCount: 7578, topic: "boxing" },
  { id: "TzzU-5roDVU", title: "Dave Allen Being Dave Allen Thomas Carty Fight Confirmed For Sept 5", channel: "Matchroom Boxing", description: "Full fight highlights and knockouts.", publishedAt: "2026-06-30T16:03:12+00:00", viewCount: 5233, topic: "boxing" },
  { id: "yBc0tdwxNEM", title: "DON’T MESS with “Jojo” Are you ready for Johan Ghazali vs Ramadan Ondash at The Inner Circle 24?", channel: "ONE Championship", description: "Full fight highlights and knockouts.", publishedAt: "2026-07-04T11:00:38+00:00", viewCount: 8306, topic: "one" },
  { id: "gpgNT9ItZ7Y", title: "Malaysian-Thai PRODIGY Meets A Living Legend Aliff vs. Sam-A | Road To Gold Highlights", channel: "ONE Championship", description: "Full fight highlights and knockouts.", publishedAt: "2026-07-04T11:00:01+00:00", viewCount: 21177, topic: "one" },
  { id: "bHKXyf2AN3w", title: "Polaris Just Dropped One Of The Best Brackets Of The Year | The FloGrappling Show (Ep 94)", channel: "FloGrappling", description: "Full fight highlights and knockouts.", publishedAt: "2026-06-29T20:11:34+00:00", viewCount: 1857, topic: "bjj" },
  { id: "MaCj-Cq-sAU", title: "17 Jiu Jitsu Submissions From Kade & Tye Ruotolo", channel: "FloGrappling", description: "Full fight highlights and knockouts.", publishedAt: "2026-06-29T15:00:07+00:00", viewCount: 4611, topic: "bjj" },
];
