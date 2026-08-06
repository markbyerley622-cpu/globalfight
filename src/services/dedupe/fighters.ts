// Fighter identity resolution for the provider-sync path.
//
// ── This is now a THIN ADAPTER, not an implementation ────────────────────────
//
// It used to be the second of three separate identity implementations in the
// codebase (the third being `slugify(name)`, which eight ingest paths used as
// the primary key of a human being). Its precedence ladder was reasonable —
// external id, then alias, then name — but it had no corroboration, no
// ambiguity detection, and no way to say "I am not sure": a two-way tie silently
// returned whichever candidate the query happened to order first.
//
// Everything now delegates to lib/registry/identity, so there is exactly ONE
// answer to "who is this?" in the product. This file survives only to keep the
// sync path's call signature and its `FighterMatch` shape unchanged, because
// persist.ts branches on `match.fighterId` and treats a null as "insert".
//
// The behavioural change the caller WILL see, and should: an uncertain match now
// returns `fighterId: null` where it previously returned a guess. persist.ts
// treats that as new, which creates a provisional row — and the resolver has
// already queued the possible match for review, so the pair is visible instead
// of being merged on a coin flip.

import { resolveFighterIdentity } from "@/lib/registry/identity";
import type { Sport } from "@/lib/types";

export type MatchType = "external_id" | "alias" | "name_exact" | "name_loose" | "none";

export interface FighterMatch {
  fighterId: string | null;
  matchType: MatchType;
  confidence: number; // 0..1
}

export interface ResolveFighterInput {
  source: string;
  externalId?: string;
  name: string;
  sport: Sport;
  /** Corroborating facts, when the provider supplies them. Optional so existing
   *  callers compile unchanged; passing them is what turns a name inference into
   *  a confident match (see identity-rules::corroborate). */
  birthDate?: Date | string | null;
  countryCode?: string | null;
  nationality?: string | null;
}

/** The canonical resolver's `via` vocabulary, mapped onto this path's older one. */
const MATCH_TYPE: Record<string, MatchType> = {
  external_id: "external_id",
  registry_id: "external_id",
  alias: "alias",
  nickname: "alias",
  name_exact: "name_exact",
  name_loose: "name_loose",
  paternal: "name_loose",
  initial: "name_loose",
  translit: "name_loose",
  acronym: "name_loose",
};

export async function resolveFighter(input: ResolveFighterInput): Promise<FighterMatch> {
  const resolution = await resolveFighterIdentity({
    name: input.name,
    sport: input.sport as never,
    externalIds: input.externalId ? [{ source: input.source, externalId: input.externalId }] : [],
    birthDate: input.birthDate ?? null,
    countryCode: input.countryCode ?? null,
    nationality: input.nationality ?? null,
  });

  if (!resolution.fighterId) {
    return { fighterId: null, matchType: "none", confidence: resolution.verdict.confidence };
  }

  const via = resolution.candidates[0]?.via ?? "name_exact";
  return {
    fighterId: resolution.fighterId,
    matchType: MATCH_TYPE[via] ?? "name_exact",
    confidence: resolution.verdict.confidence,
  };
}
