import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical FighterProfile schema (single source of truth for the payload).
// Kept intentionally permissive on strings (a prototype captures partial data)
// while enforcing the hard rules: stats are non-negative numbers, arrays are
// arrays. Required-field completeness is reported separately (see questionBank)
// so we never *throw* on an in-progress draft.
// ---------------------------------------------------------------------------

export const fightSchema = z.object({
  date: z.string().optional(),
  opponent: z.string(),
  result: z.string(),
  method: z.string().optional(),
  round: z.string().optional(),
  location: z.string().optional(),
});
export type Fight = z.infer<typeof fightSchema>;

export const highlightSchema = z.object({
  title: z.string(),
  url: z.string(),
});

export const galleryItemSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  localUrl: z.string(),
  caption: z.string().optional(),
  chapterLabel: z.string().optional(),
});
export type GalleryItem = z.infer<typeof galleryItemSchema>;

export const sponsorSchema = z.object({
  name: z.string(),
  logoFileName: z.string().optional(),
  url: z.string().optional(),
});

export const fighterProfileSchema = z.object({
  identity: z.object({
    fullName: z.string(),
    displayName: z.string(),
    nickname: z.string().optional(),
    role: z.string(),
    tagline: z.string(),
  }),
  bio: z.object({
    aboutHeadline: z.string(),
    aboutBody: z.string(),
  }),
  vitals: z.object({
    division: z.string(),
    nationality: z.string(),
    residence: z.string(),
    birthplace: z.string(),
    age: z.number().nonnegative().optional(),
    dateOfBirth: z.string().optional(),
    careerSpan: z.string().optional(),
    debutDate: z.string().optional(),
    bouts: z.number().nonnegative().optional(),
    rounds: z.number().nonnegative().optional(),
    koRate: z.string().optional(),
    ranking: z.string().optional(),
    // Raw fighter data. Division/weight-class can be derived from this later
    // (with gender, sport, ruleset, region) — it is not asked for up front.
    fightingWeight: z
      .object({ value: z.number().nonnegative(), unit: z.enum(["kg", "lb"]) })
      .optional(),
  }),
  record: z.object({
    wins: z.number().nonnegative(),
    losses: z.number().nonnegative(),
    draws: z.number().nonnegative(),
    kos: z.number().nonnegative(),
    fights: z.array(fightSchema),
  }),
  media: z.object({
    highlights: z.array(highlightSchema),
    mainHighlightsUrl: z.string().optional(),
    gallery: z.array(galleryItemSchema),
  }),
  socials: z.object({
    youtube: z.string().optional(),
    instagram: z.string().optional(),
    tiktok: z.string().optional(),
    x: z.string().optional(),
    facebook: z.string().optional(),
    twitch: z.string().optional(),
    threads: z.string().optional(),
    linkedin: z.string().optional(),
    snapchat: z.string().optional(),
    website: z.string().optional(),
  }),
  sponsors: z.array(sponsorSchema),
  contact: z.object({
    businessEmail: z.string(),
    bookingUrlOrEmail: z.string(),
  }),
});

export type FighterProfile = z.infer<typeof fighterProfileSchema>;

export function emptyProfile(): FighterProfile {
  return {
    identity: { fullName: "", displayName: "", nickname: "", role: "", tagline: "" },
    bio: { aboutHeadline: "", aboutBody: "" },
    vitals: {
      division: "",
      nationality: "",
      residence: "",
      birthplace: "",
      age: undefined,
      dateOfBirth: "",
      careerSpan: "",
      debutDate: "",
      bouts: undefined,
      rounds: undefined,
      koRate: "",
      ranking: "",
      fightingWeight: undefined,
    },
    record: { wins: 0, losses: 0, draws: 0, kos: 0, fights: [] },
    media: { highlights: [], mainHighlightsUrl: "", gallery: [] },
    socials: {},
    sponsors: [],
    contact: { businessEmail: "", bookingUrlOrEmail: "" },
  };
}
