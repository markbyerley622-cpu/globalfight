// ════════════════════════════════════════════════════════════════════════
//  Wikipedia / Wikidata profile source.
//
//  • MediaWiki API → representative photo (PageImages "original") + Wikidata id.
//  • Wikidata entity → birth date (P569), height (P2048), citizenship (P27).
//
//  Open, no auth, polite UA. Best-effort: any missing field is simply omitted;
//  this is the priority source for MMA/regional fighters (no the data source id) and the
//  fallback for everyone else.
// ════════════════════════════════════════════════════════════════════════

import { log } from "@/lib/scraper/logger";

const UA = "CombatRegisterBot/2.0 (+https://combat-register.vercel.app/bot)";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA = "https://www.wikidata.org/wiki/Special:EntityData";

const UNIT_CM = "Q174728";
const UNIT_M = "Q11573";

export interface WikiProfile {
  imageSourceUrl?: string;
  birthDate?: string;   // YYYY-MM-DD
  heightCm?: number;
  nationality?: string;
  // Image attribution (only set when the photo is a FREE-licensed Commons file).
  photoCredit?: string;
  photoLicense?: string;
  photoLicenseUrl?: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

interface WikiQuery {
  query?: { pages?: Record<string, {
    title: string;
    original?: { source: string };
    pageprops?: { wikibase_item?: string };
  }> };
}

interface WdEntity {
  labels?: { en?: { value: string } };
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value: unknown } } }>>;
}
interface WikidataEntity {
  entities?: Record<string, WdEntity>;
}

const claimValue = (e: WdEntity | undefined, prop: string) =>
  e?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;

const stripHtml = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

// A licence string we're allowed to display with attribution. Non-free / fair-use
// files (which exist on en.wiki but never on Commons) are rejected.
const FREE_LICENSE = /\b(cc[\s-]?by|cc0|public domain|no restrictions|pd-|attribution)\b/i;

interface ImageInfoResp {
  query?: { pages?: Record<string, {
    imageinfo?: Array<{ extmetadata?: Record<string, { value?: string }> }>;
  }> };
}

/**
 * Fetch a Commons file's licence + author from its extmetadata. Returns null
 * unless the file is on Commons AND carries a recognised FREE licence — so we
 * only ever store a photo we can legally display with credit.
 */
async function fetchImageLicense(
  imageUrl: string,
): Promise<{ credit?: string; license: string; licenseUrl?: string } | null> {
  // Commons files live under upload.wikimedia.org/.../commons/...
  if (!/upload\.wikimedia\.org\/.*\/commons\//i.test(imageUrl)) return null;
  const filename = decodeURIComponent(imageUrl.split("/").pop() ?? "");
  if (!filename) return null;

  const url = `${WIKI_API}?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(
    "File:" + filename,
  )}`;
  const data = await fetchJson<ImageInfoResp>(url);
  const pages = data?.query?.pages;
  if (!pages) return null;
  const meta = Object.values(pages)[0]?.imageinfo?.[0]?.extmetadata;
  if (!meta) return null;

  const license = (meta.LicenseShortName?.value ?? meta.License?.value ?? "").trim();
  if (!license || !FREE_LICENSE.test(license)) return null; // reject non-free / unknown

  const credit = meta.Artist?.value ? stripHtml(meta.Artist.value) : undefined;
  const licenseUrl = meta.LicenseUrl?.value?.trim() || undefined;
  return { credit: credit || undefined, license, licenseUrl };
}

/** Pull a fighter's photo + structured bio from Wikipedia/Wikidata by name. */
export async function fetchWikipediaProfile(name: string): Promise<WikiProfile> {
  const out: WikiProfile = {};

  const q = `${WIKI_API}?action=query&format=json&redirects=1&prop=pageimages%7Cpageprops&piprop=original&ppprop=wikibase_item&titles=${encodeURIComponent(name)}`;
  const data = await fetchJson<WikiQuery>(q);
  const pages = data?.query?.pages;
  if (!pages) return out;
  const page = Object.values(pages)[0];
  if (!page || "missing" in page) return out;

  // Capture the photo licence up-front, but COMMIT it only after Wikidata
  // confirms this page is an athlete (below). Name matching alone can land on a
  // non-athlete namesake — we must not put a stranger's photo on a fighter.
  const candidateImage = page.original?.source;
  const imageLic = candidateImage ? await fetchImageLicense(candidateImage) : null;

  const wikidataId = page.pageprops?.wikibase_item;
  if (!wikidataId) return out;

  const entityData = await fetchJson<WikidataEntity>(`${WIKIDATA}/${wikidataId}.json`);
  const entity = entityData?.entities?.[wikidataId];
  if (!entity) return out;

  // Athlete guard: require a "sport" (P641) claim before trusting the photo, so
  // a same-name non-athlete (e.g. a namesake in the news) never supplies a face.
  if (candidateImage && imageLic && entity.claims?.["P641"]) {
    out.imageSourceUrl = candidateImage;
    out.photoCredit = imageLic.credit;
    out.photoLicense = imageLic.license;
    out.photoLicenseUrl = imageLic.licenseUrl;
  }

  // Birth date (P569) — ISO time like "+1991-10-27T00:00:00Z".
  const dob = claimValue(entity, "P569") as { time?: string } | undefined;
  if (dob?.time) out.birthDate = dob.time.slice(1, 11);

  // Height (P2048) — amount + unit (cm or m).
  const ht = claimValue(entity, "P2048") as { amount?: string; unit?: string } | undefined;
  if (ht?.amount) {
    const n = parseFloat(ht.amount);
    if (Number.isFinite(n)) {
      const isMetres = ht.unit?.includes(UNIT_M) && !ht.unit?.includes(UNIT_CM);
      out.heightCm = Math.round(isMetres ? n * 100 : n);
    }
  }

  // Citizenship (P27) → resolve the country's English label.
  const cit = claimValue(entity, "P27") as { id?: string } | undefined;
  if (cit?.id) {
    const countryData = await fetchJson<WikidataEntity>(`${WIKIDATA}/${cit.id}.json`);
    const label = countryData?.entities?.[cit.id]?.labels?.en?.value;
    // Wikidata sometimes disambiguates e.g. "Georgia (country)" — trim that.
    if (label) out.nationality = label.replace(/\s*\(country\)$/i, "");
  }

  log.info({ name, gotImage: !!out.imageSourceUrl, fields: Object.keys(out).length }, "wiki:profile");
  return out;
}
