// Native Combat Register community predictions — distinct from the external
// market feed. Users vote; tallies are real and persisted.

export type CommunityKind = "who_wins" | "will_happen" | "fotn" | "prop";

export type CommunityOption = { id: string; label: string; sub?: string };

/** Combat Register community vote attached to an external live market. */
export type MarketVote = {
  tally: Record<string, number>;
  voteCount: number;
  myVote: string | null;
  options: CommunityOption[];
};

/** The shape the community UI consumes (mirrors the live market where useful). */
export type CommunityMarketView = {
  id: string;
  slug: string;
  kind: CommunityKind;
  sport: string; // UI label: "Boxing" | "MMA" | …
  league: string | null;
  title: string;
  subtitle: string | null; // weight class / context
  statusLabel: string | null; // editorial, e.g. "RUMOURED"
  description: string | null;
  status: "open" | "closed" | "resolved";
  closesAt: string | null;
  options: CommunityOption[];
  /** Vote counts keyed by option id. */
  tally: Record<string, number>;
  voteCount: number;
  featured: boolean;
  hot: boolean;
  /** The signed-in user's chosen option id, if any. */
  myVote: string | null;
};
