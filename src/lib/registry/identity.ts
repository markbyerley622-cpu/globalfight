import "server-only";
import type { Prisma, Sport } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nameKey } from "@/lib/entities/forms";
import { candidate, resolveName, type ResolvedEntity, type ResolutionVia } from "@/lib/entities/resolve";
import {
  corroborate, decide, demoteAcrossSports, isActionable, isReviewable,
  type IdentityFacts, type Verdict,
} from "./identity-rules";

// ════════════════════════════════════════════════════════════════════════════
//  THE CANONICAL FIGHTER RESOLVER. One function. Every path calls it.
//
//  ── What this replaces ───────────────────────────────────────────────────
//  Three implementations and a convention:
//
//    entities/resolve.ts        a good deterministic ladder — called by NOTHING
//    services/dedupe/fighters   external-id first, but no corroboration, no
//                               ambiguity detection, used only by the sync path
//    slugify(name)              the actual identity key for EIGHT of the nine
//                               fighter-creation paths in the codebase
//
//  The audit's sharpest finding was that `FighterExternalId` had four writers
//  and ZERO readers: the provider ids needed to identify a fighter were being
//  collected on every sync and thrown away, while the same sync identified
//  people by a slug derived from their display name. This module is where that
//  table finally gets read.
//
//  ── Resolution order ─────────────────────────────────────────────────────
//    1. external id      (source, externalId)   exact — an identity claim
//    2. registry alias   normalized             exact
//    3. the deterministic ladder from entities/resolve, open-set
//    4. corroboration    birthdate, then nationality
//    5. no confident answer → a review candidate. NEVER an automatic merge,
//       and never a silent second row for the same person.
//
//  ── It never reimplements the ladder ─────────────────────────────────────
//  Steps 3 is `resolveName` from entities/resolve.ts, unchanged: the same pure,
//  tested, ambiguity-aware comparison the enrichment layer already uses. What
//  this module adds is the DATABASE half (which candidates to compare against)
//  and the DECISION half (identity-rules), both of which the pure module
//  deliberately refuses to own.
// ════════════════════════════════════════════════════════════════════════════

export interface ExternalRef {
  source: string;
  externalId: string;
}

export interface FighterIdentityInput {
  name: string;
  sport?: Sport | null;
  /** Provider ids. Checked FIRST — this is the whole point of the module. */
  externalIds?: ExternalRef[];
  nickname?: string | null;
  birthDate?: Date | string | null;
  countryCode?: string | null;
  nationality?: string | null;
  /** Alternate spellings the provider supplied. */
  aliases?: string[];
}

export interface IdentityResolution {
  verdict: Verdict;
  /** The canonical fighter, when the verdict is actionable. */
  fighterId: string | null;
  /** Everything worth a reviewer's attention, best first. */
  candidates: { fighterId: string; via: ResolutionVia; confidence: number; name: string }[];
}

type CandidateRow = {
  id: string;
  slug: string;
  name: string;
  nickname: string | null;
  sport: Sport;
  sports: Sport[];
  birthDate: Date | null;
  countryCode: string | null;
  nationality: string | null;
};

const CANDIDATE_SELECT = {
  id: true, slug: true, name: true, nickname: true, sport: true, sports: true,
  birthDate: true, countryCode: true, nationality: true,
} as const;

/**
 * Identify a fighter. READ-ONLY — this never writes, so it is safe to call from
 * an audit, a dry run or a preview.
 */
export async function resolveFighterIdentity(
  input: FighterIdentityInput,
): Promise<IdentityResolution> {
  // ── 1. External id. An exact identity claim; nothing outranks it. ────────
  for (const ref of input.externalIds ?? []) {
    if (!ref.source || !ref.externalId) continue;
    const link = await prisma.fighterExternalId
      .findUnique({
        where: { source_externalId: { source: ref.source, externalId: ref.externalId } },
        select: { fighterId: true, fighter: { select: { name: true } } },
      })
      .catch(() => null);
    if (link) {
      return {
        verdict: { outcome: "MATCH_CONFIDENT", confidence: 1, reason: `external_id:${ref.source}` },
        fighterId: link.fighterId,
        candidates: [{ fighterId: link.fighterId, via: "external_id", confidence: 1, name: link.fighter.name }],
      };
    }
  }

  const key = nameKey(input.name);
  if (!key) {
    return { verdict: { outcome: "NO_MATCH", confidence: 0, reason: "unusable name" }, fighterId: null, candidates: [] };
  }

  // ── 2 + 3. Gather candidates, then run the deterministic ladder. ─────────
  const rows = await gatherCandidates(key, input);
  if (rows.length === 0) {
    return { verdict: { outcome: "NO_MATCH", confidence: 0, reason: "no candidates" }, fighterId: null, candidates: [] };
  }

  const aliasesById = await aliasesFor(rows.map((r) => r.id));
  const entities: ResolvedEntity[] = rows.map((r) =>
    candidate("fighter", {
      id: r.id, slug: r.slug, name: r.name, nickname: r.nickname,
      aliases: aliasesById.get(r.id) ?? [],
    }),
  );

  // openSet: candidates were narrowed from the whole fighter table, so the weak
  // rungs (initials, acronyms, romanisation folds) are refused. "AJ" is Anthony
  // Joshua on an Anthony Joshua card; against 10,000 fighters it is noise.
  const res = resolveName(input.name, entities, { openSet: true });

  if (!res.ok) {
    // AMBIGUOUS is not a failure to be retried with looser rules — it is the
    // correct answer, and the one the old slug key could never give. Two people
    // genuinely matched; a human decides which.
    if (res.reason === "ambiguous") {
      const tied = res.tied.flatMap((t) => (t.id ? [{ fighterId: t.id, via: t.via, confidence: t.confidence, name: t.name }] : []));
      return {
        verdict: { outcome: "AMBIGUOUS", confidence: tied[0]?.confidence ?? 0, reason: `ambiguous:${tied.length} candidates` },
        fighterId: null,
        candidates: tied,
      };
    }
    return { verdict: { outcome: "NO_MATCH", confidence: 0, reason: "no ladder hit" }, fighterId: null, candidates: [] };
  }

  // ── 4. Corroborate against hard facts. ──────────────────────────────────
  const matched = rows.find((r) => r.id === res.entity.id);
  if (!matched) {
    return { verdict: { outcome: "NO_MATCH", confidence: 0, reason: "candidate vanished" }, fighterId: null, candidates: [] };
  }

  const incoming: IdentityFacts = {
    birthDate: input.birthDate ?? null,
    countryCode: input.countryCode ?? null,
    nationality: input.nationality ?? null,
  };
  const held: IdentityFacts = {
    birthDate: matched.birthDate,
    countryCode: matched.countryCode,
    nationality: matched.nationality,
  };

  let verdict = decide(res.via, corroborate(incoming, held));
  verdict = demoteAcrossSports(verdict, sportAgrees(input.sport, matched), res.via);

  return {
    verdict,
    fighterId: isActionable(verdict) ? matched.id : null,
    candidates: [{ fighterId: matched.id, via: res.via, confidence: verdict.confidence, name: matched.name }],
  };
}

/**
 * Candidates to compare against, from TWO narrow reads.
 *
 * Deliberately NOT filtered by sport. The registry models a fighter as
 * multi-discipline (`Fighter.sports` is an array), so filtering would guarantee
 * a crossover athlete gets two rows — and it would also hide the exact
 * same-name-different-sport collision that most needs a human to look at.
 * Disagreement is handled by demoteAcrossSports, not by refusing to see it.
 */
async function gatherCandidates(key: string, input: FighterIdentityInput): Promise<CandidateRow[]> {
  const tokens = key.split(" ").filter(Boolean);
  const surname = tokens[tokens.length - 1];
  // A one-token or very short name cannot narrow a 10,000-row table safely.
  if (!surname || surname.length < 3) return [];

  const [aliasRows, byName] = await Promise.all([
    // The alias table, including any alternate spellings the PROVIDER supplied —
    // a provider's own alias list is often how a native-script name links up.
    prisma.fighterAlias
      .findMany({
        where: { normalized: { in: [key, ...(input.aliases ?? []).map(nameKey).filter(Boolean)] } },
        select: { fighterId: true },
        take: 20,
      })
      .catch(() => [] as { fighterId: string }[]),
    prisma.fighter.findMany({
      where: { name: { contains: surname, mode: "insensitive" } },
      select: CANDIDATE_SELECT,
      take: 50,
    }),
  ]);

  const aliasIds = aliasRows.map((r) => r.fighterId).filter((id) => !byName.some((f) => f.id === id));
  const extra = aliasIds.length
    ? await prisma.fighter.findMany({ where: { id: { in: aliasIds } }, select: CANDIDATE_SELECT })
    : [];

  const merged = new Map<string, CandidateRow>();
  for (const row of [...byName, ...extra]) merged.set(row.id, row);
  return [...merged.values()];
}

async function aliasesFor(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const rows = await prisma.fighterAlias
    .findMany({ where: { fighterId: { in: ids } }, select: { fighterId: true, alias: true } })
    .catch(() => [] as { fighterId: string; alias: string }[]);
  for (const r of rows) out.set(r.fighterId, [...(out.get(r.fighterId) ?? []), r.alias]);
  return out;
}

/** Does the incoming sport overlap anything the held row is known to compete in? */
function sportAgrees(incoming: Sport | null | undefined, row: CandidateRow): boolean {
  if (!incoming) return true; // nothing to disagree with
  if (row.sport === incoming) return true;
  return row.sports.includes(incoming);
}

// ─── Write path ─────────────────────────────────────────────────────────────

export interface ResolveOrCreateResult {
  fighterId: string;
  created: boolean;
  outcome: Verdict["outcome"];
  /** Set when the resolver queued a question instead of answering it. */
  reviewQueued: boolean;
}

/**
 * Identify a fighter, or create a provisional canonical entry for them.
 *
 * THE one entry point for every ingest path. What it guarantees:
 *
 *   • an external id is linked on the way through, so the NEXT run resolves at
 *     rung 1 instead of guessing from a name. The registry gets more certain
 *     over time rather than re-deriving the same inference forever;
 *   • an incoming name that differs from the canonical one is recorded as an
 *     ALIAS rather than becoming a second fighter — which is precisely how
 *     "Alex Volkanovski" and "Alexander Volkanovski" stop being two people;
 *   • a merge is NEVER performed automatically below the threshold. An uncertain
 *     match creates a provisional row AND a review candidate linking the two, so
 *     nothing is lost and nothing is silently conflated.
 *
 * ── On slug suffixes ────────────────────────────────────────────────────────
 * A `-2` slug is not itself the bug the audit found. Two genuinely different
 * people called Jon Jones need two URLs. The bug was minting one WITHOUT ever
 * asking whether they were the same person — the signup path went straight from
 * "slug taken" to "make a new fighter". Here the identity question is answered
 * first, and a suffix is only reached once the answer is "different person".
 */
export async function resolveOrCreateFighter(
  input: FighterIdentityInput,
  opts: { origin?: string; sportFallback?: Sport } = {},
): Promise<ResolveOrCreateResult> {
  const resolution = await resolveFighterIdentity(input);

  if (resolution.fighterId) {
    await recordProvenance(resolution.fighterId, input);
    return { fighterId: resolution.fighterId, created: false, outcome: resolution.verdict.outcome, reviewQueued: false };
  }

  // Not confident. Create the provisional entry FIRST so the ingest is never
  // blocked on a human — the data still lands, it simply lands as its own row
  // with an open question attached to it.
  const created = await createProvisional(input, opts.sportFallback);
  await recordProvenance(created, input);

  let reviewQueued = false;
  if (isReviewable(resolution.verdict)) {
    reviewQueued = await queueCandidates(created, resolution, input, opts.origin ?? "ingest");
  }

  return { fighterId: created, created: true, outcome: resolution.verdict.outcome, reviewQueued };
}

/** Link external ids and record alternate names. Best-effort, never fatal. */
async function recordProvenance(fighterId: string, input: FighterIdentityInput): Promise<void> {
  for (const ref of input.externalIds ?? []) {
    if (!ref.source || !ref.externalId) continue;
    // upsert, not create: two ingests racing the same provider id must not turn
    // a successful link into a P2002 that fails the whole row (CLAUDE.md rule 4).
    await prisma.fighterExternalId
      .upsert({
        where: { source_externalId: { source: ref.source, externalId: ref.externalId } },
        create: { fighterId, source: ref.source, externalId: ref.externalId, confidence: 1 },
        update: {},
      })
      .catch(() => {});
  }

  const names = [input.name, ...(input.aliases ?? [])];
  const canonical = await prisma.fighter.findUnique({ where: { id: fighterId }, select: { name: true } });
  for (const raw of names) {
    const normalized = nameKey(raw);
    // Only record a name that ADDS something. Storing the canonical name as its
    // own alias is noise on a table read in the identity hot path.
    if (!normalized || !canonical || normalized === nameKey(canonical.name)) continue;
    await prisma.fighterAlias
      .upsert({
        where: { fighterId_normalized: { fighterId, normalized } },
        create: { fighterId, alias: raw.trim(), normalized, source: "ingest" },
        update: {},
      })
      .catch(() => {});
  }
}

/** A minimal canonical row for someone we have not seen before. */
async function createProvisional(input: FighterIdentityInput, fallback?: Sport): Promise<string> {
  const base = slugOf(input.name);
  let slug = base;
  // Only reached once identity has already answered "different person".
  for (let i = 2; await prisma.fighter.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }
  const row = await prisma.fighter.create({
    data: {
      slug,
      name: input.name.trim(),
      nickname: input.nickname ?? undefined,
      sport: (input.sport ?? fallback ?? "MMA") as Sport,
      countryCode: input.countryCode ?? undefined,
      nationality: input.nationality ?? undefined,
      birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
    },
    select: { id: true },
  });
  return row.id;
}

/** Record "these two might be the same person" for review. */
async function queueCandidates(
  fighterId: string,
  resolution: IdentityResolution,
  input: FighterIdentityInput,
  origin: string,
): Promise<boolean> {
  let queued = false;
  for (const c of resolution.candidates) {
    if (c.fighterId === fighterId) continue;
    await prisma.fighterIdentityCandidate
      .upsert({
        where: { fighterId_candidateId: { fighterId, candidateId: c.fighterId } },
        create: {
          fighterId,
          candidateId: c.fighterId,
          via: c.via,
          confidence: resolution.verdict.confidence,
          origin,
          // The comparable FACTS, so a reviewer decides from data rather than
          // from a number they have no way to interpret.
          evidence: {
            reason: resolution.verdict.reason,
            incomingName: input.name,
            candidateName: c.name,
            birthDate: input.birthDate ? new Date(input.birthDate).toISOString().slice(0, 10) : null,
            countryCode: input.countryCode ?? null,
            externalIds: input.externalIds ?? [],
          } as unknown as Prisma.InputJsonValue,
        },
        update: {},
      })
      .catch(() => {});
    queued = true;
  }
  return queued;
}

/** URL key. Identity is decided before this is ever reached. */
function slugOf(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "fighter"
  );
}
