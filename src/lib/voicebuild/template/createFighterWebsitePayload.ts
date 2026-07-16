import type { FighterProfile } from "../fighterProfileSchema";
import * as V from "../utils/profileValidation";
import { fighterWebsitePayloadSchema, type FighterWebsitePayload } from "./fighterWebsitePayloadSchema";

// Derives the backend-ready website payload from the CONFIRMED profile only.
// Defensively drops invalid / placeholder / empty values and empty array rows,
// then validates the whole payload with Zod.

const clean = (v?: unknown): string | undefined => {
  const s = String(v ?? "").trim();
  return s && !V.looksPlaceholder(s) ? s : undefined;
};
const numOrU = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const validUrl = (v?: unknown): string | undefined => {
  const r = V.validateUrl(String(v ?? ""));
  return r.status === "valid" ? (r.value as string) : undefined;
};

export type PayloadResult = {
  payload: FighterWebsitePayload;
  valid: boolean;
  issues: string[];
};

export function createFighterWebsitePayload(p: FighterProfile): PayloadResult {
  const fullName = clean(p.identity.fullName) ?? "";
  const displayName = clean(p.identity.displayName) ?? fullName;
  const stats = {
    wins: p.record.wins || 0,
    losses: p.record.losses || 0,
    draws: p.record.draws || 0,
    kos: p.record.kos || 0,
  };

  const fights = V.validateArrayRows("fights", p.record.fights).rows.map((r) => ({
    date: clean(r.date),
    opponent: String(r.opponent),
    result: clean(r.result),
    method: clean(r.method),
    round: clean(r.round),
    location: clean(r.location),
  }));

  const highlightClips = V.validateArrayRows("highlights", p.media.highlights).rows
    .filter((r) => V.validateUrl(r.url).status === "valid")
    .map((r) => ({ title: clean(r.title), url: validUrl(r.url) as string }));

  const gallery = (p.media.gallery || []).map((g) => ({
    fileName: g.fileName,
    localUrl: g.localUrl,
    caption: clean(g.caption),
    chapterLabel: clean(g.chapterLabel),
  }));

  const socials: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.socials || {})) {
    if (!v) continue;
    const r = k === "website" ? V.validateUrl(String(v)) : V.validateSocialHandleOrUrl(k, String(v));
    if (r.status === "valid") socials[k] = r.value as string;
  }

  const sponsors = V.validateArrayRows("sponsors", p.sponsors).rows.map((r) => ({
    name: String(r.name),
    url: clean(r.url),
    logoFileName: clean(r.logoFileName),
  }));

  const fw =
    p.vitals.fightingWeight && V.validateFightingWeight(p.vitals.fightingWeight, { manualConfirmed: true }).status !== "invalid"
      ? p.vitals.fightingWeight
      : undefined;

  const payload: FighterWebsitePayload = {
    templateVersion: "fighter-profile-v1",
    identity: {
      fullName,
      displayName,
      nickname: clean(p.identity.nickname),
      role: clean(p.identity.role),
      tagline: clean(p.identity.tagline),
    },
    hero: {
      title: displayName || fullName,
      eyebrow: clean(p.identity.role),
      tagline: clean(p.identity.tagline),
      stats,
    },
    about: { headline: clean(p.bio.aboutHeadline), body: clean(p.bio.aboutBody) },
    vitals: {
      fightingWeight: fw,
      division: clean(p.vitals.division),
      nationality: clean(p.vitals.nationality),
      residence: clean(p.vitals.residence),
      birthplace: clean(p.vitals.birthplace),
      age: numOrU(p.vitals.age),
      debutDate: p.vitals.debutDate && V.validateDateish(p.vitals.debutDate).status !== "invalid" ? clean(p.vitals.debutDate) : undefined,
      bouts: numOrU(p.vitals.bouts),
      rounds: numOrU(p.vitals.rounds),
      ranking: clean(p.vitals.ranking),
    },
    record: { ...stats, fights },
    media: {
      mainHighlightsUrl: validUrl(p.media.mainHighlightsUrl),
      highlightClips,
      gallery,
    },
    socials,
    sponsors,
    contact: {
      businessEmail: V.validateEmail(p.contact.businessEmail).status === "valid" ? (V.validateEmail(p.contact.businessEmail).value as string) : undefined,
      bookingUrlOrEmail: V.validateUrlOrEmail(p.contact.bookingUrlOrEmail).status === "valid" ? (V.validateUrlOrEmail(p.contact.bookingUrlOrEmail).value as string) : undefined,
    },
  };

  const parsed = fighterWebsitePayloadSchema.safeParse(payload);
  return {
    payload,
    valid: parsed.success,
    issues: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
