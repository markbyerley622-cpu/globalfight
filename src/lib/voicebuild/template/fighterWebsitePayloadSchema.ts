import { z } from "zod";

// Backend-ready payload for the generic fighter website template. This is the
// clean seam between the voice/onboarding profile and the site template.
export const fighterWebsitePayloadSchema = z.object({
  templateVersion: z.literal("fighter-profile-v1"),
  identity: z.object({
    fullName: z.string(),
    displayName: z.string(),
    nickname: z.string().optional(),
    role: z.string().optional(),
    tagline: z.string().optional(),
  }),
  hero: z.object({
    title: z.string(),
    eyebrow: z.string().optional(),
    tagline: z.string().optional(),
    stats: z.object({ wins: z.number(), losses: z.number(), draws: z.number(), kos: z.number() }),
  }),
  about: z.object({ headline: z.string().optional(), body: z.string().optional() }),
  vitals: z.object({
    fightingWeight: z.object({ value: z.number(), unit: z.enum(["kg", "lb"]) }).optional(),
    division: z.string().optional(),
    nationality: z.string().optional(),
    residence: z.string().optional(),
    birthplace: z.string().optional(),
    age: z.number().optional(),
    debutDate: z.string().optional(),
    bouts: z.number().optional(),
    rounds: z.number().optional(),
    ranking: z.string().optional(),
  }),
  record: z.object({
    wins: z.number(),
    losses: z.number(),
    draws: z.number(),
    kos: z.number(),
    fights: z.array(
      z.object({
        date: z.string().optional(),
        opponent: z.string(),
        result: z.string().optional(),
        method: z.string().optional(),
        round: z.string().optional(),
        location: z.string().optional(),
      }),
    ),
  }),
  media: z.object({
    mainHighlightsUrl: z.string().optional(),
    highlightClips: z.array(z.object({ title: z.string().optional(), url: z.string() })),
    gallery: z.array(
      z.object({
        fileName: z.string(),
        localUrl: z.string(),
        caption: z.string().optional(),
        chapterLabel: z.string().optional(),
      }),
    ),
  }),
  socials: z.record(z.string(), z.string().optional()),
  sponsors: z.array(z.object({ name: z.string(), url: z.string().optional(), logoFileName: z.string().optional() })),
  contact: z.object({ businessEmail: z.string().optional(), bookingUrlOrEmail: z.string().optional() }),
});

export type FighterWebsitePayload = z.infer<typeof fighterWebsitePayloadSchema>;
