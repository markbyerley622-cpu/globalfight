import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { resolvePromotion } from "@/lib/promotions";
import { nameKey } from "@/lib/entities/forms";
import {
  candidate,
  textOnly,
  resolveName,
  type EventEntities,
  type ResolvedEntity,
} from "@/lib/entities/resolve";
import type { Fight, FightEvent, Sport } from "@/lib/types";

// ════════════════════════════════════════════════════════════════════════════
//  The Registry side of entity resolution — the only module here that touches a
//  database. It turns registry ROWS into the matchable ResolvedEntity objects
//  that resolve.ts compares against, and it is where "registry-first" is
//  actually enforced.
//
//  The important case is the CHEAP one. On an event we already hold the
//  canonical Fighter rows (a fight's red/blue corners ARE registry rows with
//  ids), so resolution costs exactly ONE extra query — the alias batch — and
//  yields `via: "registry_id"` with confidence 1. There is nothing to guess.
//  Name-based resolution (resolveFighterByName) exists for the cases where a
//  caller genuinely only has a string, and it is the slower, weaker path by
//  construction.
//
//  Promotions resolve against the in-code PROMOTIONS registry (lib/promotions),
//  which is already the single source of truth for org identity.
//
//  Venues have NO registry table yet — Event.venue is free text. So a venue
//  resolves to a deterministic canonical KEY and is honestly marked
//  `via: "text_only"`. When a Venue model lands, only this function changes.
// ════════════════════════════════════════════════════════════════════════════

export type { EventEntities } from "@/lib/entities/resolve";

/** Load registry aliases for a set of fighter ids. One query, best-effort. */
async function aliasesByFighter(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  // Additive table: a database that hasn't run `db:push` for the provenance
  // models must still resolve on name/nickname rather than throwing.
  const rows = await prisma.fighterAlias
    .findMany({ where: { fighterId: { in: ids } }, select: { fighterId: true, alias: true } })
    .catch(() => [] as { fighterId: string; alias: string }[]);
  for (const r of rows) {
    const list = out.get(r.fighterId) ?? [];
    list.push(r.alias);
    out.set(r.fighterId, list);
  }
  return out;
}

/**
 * Registry-first resolution of the fighters on a card.
 *
 * We already hold the canonical rows, so this is `via: "registry_id"` — no text
 * matching is involved in identifying them. The one query adds each fighter's
 * registry ALIASES to their match surface, which is the whole point: an article
 * headlined "AJ returns" or "Tyson Fury's next move" now resolves to the same
 * fighter as "Anthony Joshua", because the surface came from the registry rather
 * than from the string on the card.
 */
export const resolveCardFighters = cache(_resolveCardFighters);

async function _resolveCardFighters(fights: Fight[]): Promise<ResolvedEntity[]> {
  const byId = new Map<string, { id: string; slug: string; name: string; nickname?: string }>();
  for (const f of fights) {
    for (const corner of [f.red, f.blue]) {
      if (corner?.id && !byId.has(corner.id)) {
        byId.set(corner.id, {
          id: corner.id,
          slug: corner.slug,
          name: corner.name,
          nickname: corner.nickname,
        });
      }
    }
  }

  const aliases = await aliasesByFighter([...byId.keys()]);
  return [...byId.values()].map((row) =>
    candidate("fighter", {
      id: row.id,
      slug: row.slug,
      name: row.name,
      nickname: row.nickname ?? null,
      aliases: aliases.get(row.id) ?? [],
    }),
  );
}

/**
 * Resolve a promotion string against the in-code registry.
 *
 * Returns null for the generic placeholder ("Various", "Multiple promotions") —
 * that is not an entity, and pretending otherwise is what put "Various" in front
 * of readers as though it were an organisation.
 */
export function resolvePromotionEntity(promotion?: string | null): ResolvedEntity | null {
  const raw = (promotion ?? "").trim();
  if (!raw) return null;
  const promo = resolvePromotion(raw);
  // The registry's neutral fallback keeps slug "combat" — a real hit never does.
  if (promo.slug === "combat") return null;
  return candidate("promotion", {
    id: promo.slug,
    slug: promo.slug,
    name: promo.name,
    aliases: [...promo.aliases, promo.mark],
  });
}

/**
 * A venue as a canonical key. There is no Venue registry table yet (Event.venue
 * is free text), so this is deterministic normalization, marked `text_only` so no
 * consumer mistakes it for a registry id. City/country ride along in the key so
 * two "Arena"s in different cities never collapse.
 */
export function resolveVenueEntity(
  venue?: string | null,
  city?: string | null,
  country?: string | null,
): ResolvedEntity | null {
  const name = (venue ?? "").trim();
  if (!name) return null;
  const key = slugify([name, city, country].filter(Boolean).join(" "));
  const entity = textOnly("venue", name);
  return { ...entity, slug: key || null };
}

/**
 * The composed entity view of one event. This is what EventEnrichment carries,
 * and what every downstream matcher (coverage, video, search, related fighters)
 * is meant to consume instead of re-deriving names.
 */
export const resolveEventEntities = cache(_resolveEventEntities);

async function _resolveEventEntities(event: FightEvent, fights: Fight[]): Promise<EventEntities> {
  const fighters = await resolveCardFighters(fights);
  const byId = new Map(fighters.map((f) => [f.id, f]));

  const headline = fights.find((f) => f.mainEvent) ?? fights[0];
  const red = headline ? byId.get(headline.red.id) : undefined;
  const blue = headline ? byId.get(headline.blue.id) : undefined;

  return {
    fighters,
    main: red && blue ? { red, blue } : null,
    promotion: resolvePromotionEntity(event.promotion),
    venue: resolveVenueEntity(event.venue, event.city, event.country),
    canonicalFighterCount: fighters.filter((f) => f.id !== null).length,
  };
}

/**
 * Resolve a bare NAME to a canonical fighter — the fallback path, for callers
 * that hold a string and nothing else (an ingest row, a search query, a link in
 * article text).
 *
 * OPEN SET: candidates are narrowed from the whole fighter table, so the weak
 * rungs (initials, acronyms, romanization folds) are refused by `resolveName`.
 * Returns null rather than a low-confidence guess — the caller then decides
 * whether deterministic text matching is good enough for its purpose.
 */
export async function resolveFighterByName(
  name: string,
  sport?: Sport | null,
): Promise<ResolvedEntity | null> {
  const key = nameKey(name);
  const tokens = key.split(" ").filter(Boolean);
  const surname = tokens[tokens.length - 1];
  if (!surname || surname.length < 3) return null;

  // Two narrowing reads: the alias table (a direct registry hit) and a surname
  // scan. Bounded, and both feed the same deterministic ladder.
  const [aliasRows, rows] = await Promise.all([
    prisma.fighterAlias
      .findMany({
        where: { normalized: key },
        select: { fighterId: true },
        take: 10,
      })
      .catch(() => [] as { fighterId: string }[]),
    prisma.fighter.findMany({
      where: {
        name: { contains: surname, mode: "insensitive" },
        ...(sport ? { sport } : {}),
      },
      select: { id: true, slug: true, name: true, nickname: true },
      take: 50,
    }),
  ]);

  const aliasIds = aliasRows.map((r) => r.fighterId);
  const extra = aliasIds.length
    ? await prisma.fighter.findMany({
        where: { id: { in: aliasIds } },
        select: { id: true, slug: true, name: true, nickname: true },
      })
    : [];

  const merged = new Map<string, { id: string; slug: string; name: string; nickname: string | null }>();
  for (const r of [...rows, ...extra]) merged.set(r.id, r);
  if (!merged.size) return null;

  const aliases = await aliasesByFighter([...merged.keys()]);
  const candidates = [...merged.values()].map((r) =>
    candidate("fighter", {
      id: r.id,
      slug: r.slug,
      name: r.name,
      nickname: r.nickname,
      aliases: aliases.get(r.id) ?? [],
    }),
  );

  const res = resolveName(name, candidates, { openSet: true });
  return res.ok ? res.entity : null;
}
