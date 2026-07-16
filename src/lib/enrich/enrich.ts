// ════════════════════════════════════════════════════════════════════════
//  Fighter profile enrichment queue.
//
//  For each fighter we fill missing bio fields and a cached photo set from
//  Wikipedia + Wikidata → photo + birth date / height / nationality.
//
//  (The BoxRec bio path was removed — Combat Register no longer scrapes BoxRec.
//  Deep bio fields now come from the licensed API providers; Wikipedia handles
//  photos + remaining public-fact bio here.)
//
//  Only EMPTY fields are filled (never overwrite curated/known data). The photo
//  is downloaded, resized into 3 cached variants, and stored on our infra.
//
//  The queue targets newly-created fighters (lastProfileScrapedAt = null) first,
//  then anything not refreshed in ENRICH_STALE_DAYS (default 30).
// ════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import { fetchWikipediaProfile } from "./wikipedia";
import { flags } from "@/lib/feature-flags";

const STALE_DAYS = Number(process.env.ENRICH_STALE_DAYS ?? 30);
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS ?? 250);

type FighterRow = {
  id: string; slug: string; name: string;
  imageUrl: string | null; photoUrl: string | null; heightCm: number | null; reachCm: number | null;
  stance: string | null; birthDate: Date | null; nationality: string | null;
};

const FIELDS = {
  id: true, slug: true, name: true, imageUrl: true, photoUrl: true,
  heightCm: true, reachCm: true, stance: true, birthDate: true, nationality: true,
} as const;

export interface EnrichResult { slug: string; updated: boolean; gotImage: boolean; filled: string[] }

/** Enrich a single fighter row. Fills only missing fields; caches the photo. */
export async function enrichFighter(f: FighterRow): Promise<EnrichResult> {
  const data: Record<string, unknown> = {};
  const filled: string[] = [];
  const fill = (key: keyof FighterRow, value: unknown) => {
    if (value != null && value !== "" && f[key] == null) { data[key] = value; filled.push(key); }
  };


  // Wikipedia / Wikidata — photo + public-fact bio (height / nationality / DOB).
  const wiki = await fetchWikipediaProfile(f.name);
  if (wiki.birthDate) {
    const dob = new Date(wiki.birthDate);
    if (!Number.isNaN(+dob)) fill("birthDate", dob); // Wikidata emits imprecise dates ("0000-…")
  }
  fill("heightCm", wiki.heightCm);
  fill("nationality", wiki.nationality);
  // ── Licensed fighter photo (Wikimedia Commons) ────────────────────────
  //
  // We do NOT re-host. We store the source URL plus the captured attribution
  // (author + licence + licence deed), and the profile renders that credit. The
  // image is displayed through the /api/img caching proxy. fetchWikipediaProfile
  // only returns imageSourceUrl when the file is a FREE-licensed Commons file, so
  // by construction we never store a photo we can't legally show with credit.
  let gotImage = false;
  if (wiki.imageSourceUrl && wiki.photoLicense && !f.photoUrl && flags().mediaIngestionEnabled) {
    data.photoUrl = wiki.imageSourceUrl;
    data.photoSource = "Wikimedia Commons";
    data.photoCredit = wiki.photoCredit ?? null;
    data.photoLicense = wiki.photoLicense;
    data.photoLicenseUrl = wiki.photoLicenseUrl ?? null;
    filled.push("photo");
    gotImage = true;
  }

  data.lastProfileScrapedAt = new Date();
  await prisma.fighter.update({ where: { id: f.id }, data });

  return { slug: f.slug, updated: filled.length > 0, gotImage, filled };
}

/**
 * Process the enrichment queue: new fighters first, then stale ones.
 * Bounded by `limit` and rate-limited so we stay polite to upstream APIs.
 */
export async function enrichPending(limit = 50): Promise<{ scanned: number; enriched: number; photos: number }> {
  const staleBefore = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  const rows = (await prisma.fighter.findMany({
    where: { OR: [{ lastProfileScrapedAt: null }, { lastProfileScrapedAt: { lt: staleBefore } }] },
    orderBy: { lastProfileScrapedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: FIELDS,
  })) as FighterRow[];

  let enriched = 0;
  let photos = 0;
  for (const f of rows) {
    try {
      const r = await enrichFighter(f);
      if (r.updated) enriched++;
      if (r.gotImage) photos++;
    } catch (e) {
      // One bad row (e.g. a malformed upstream field) must not abort the batch.
      log.warn({ slug: f.slug, err: (e as Error).message }, "enrich:fighter-failed");
    }
    if (DELAY_MS > 0) await new Promise((res) => setTimeout(res, DELAY_MS));
  }

  log.info({ scanned: rows.length, enriched, photos }, "enrich:batch-done");
  return { scanned: rows.length, enriched, photos };
}
