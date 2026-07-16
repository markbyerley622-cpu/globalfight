// Single source of truth for allowed profile fields. Extraction, validation,
// merge, required-checks and the data table all key off this registry.

export type CanonicalType =
  | "string"
  | "longText"
  | "number"
  | "enum"
  | "email"
  | "url"
  | "urlOrEmail"
  | "urlOrHandle"
  | "dateish";

export type FieldSpec = {
  label: string;
  type: CanonicalType;
  required?: boolean;
  protectedWhenManual?: boolean;
  derivedLater?: boolean;
};

export const CANONICAL_PROFILE_FIELDS: Record<string, FieldSpec> = {
  "identity.fullName": { label: "Full name", type: "string", required: true },
  "identity.displayName": { label: "Display name", type: "string" },
  "identity.nickname": { label: "Nickname", type: "string" },
  "identity.role": { label: "Role / discipline", type: "enum", protectedWhenManual: true },
  "identity.tagline": { label: "Tagline", type: "string" },

  "bio.aboutHeadline": { label: "About headline", type: "string" },
  "bio.aboutBody": { label: "About paragraph", type: "longText", required: true },

  // fightingWeight is stored as an object {value, unit}; the two sub-paths carry
  // the labels/required flags, but merge/validation treat it as one object.
  "vitals.fightingWeight.value": { label: "Fighting weight value", type: "number", required: true, protectedWhenManual: true },
  "vitals.fightingWeight.unit": { label: "Fighting weight unit", type: "enum", required: true, protectedWhenManual: true },
  "vitals.division": { label: "Division", type: "string", derivedLater: true },
  "vitals.nationality": { label: "Nationality", type: "string", protectedWhenManual: true },
  "vitals.residence": { label: "Residence", type: "string" },
  "vitals.birthplace": { label: "Birthplace", type: "string" },
  "vitals.debutDate": { label: "Debut date", type: "dateish" },
  "vitals.careerSpan": { label: "Career span", type: "string" },
  "vitals.age": { label: "Age", type: "number" },
  "vitals.bouts": { label: "Bouts", type: "number" },
  "vitals.rounds": { label: "Rounds", type: "number" },
  "vitals.koRate": { label: "KO rate", type: "string" },
  "vitals.ranking": { label: "Ranking", type: "string" },

  "record.wins": { label: "Wins", type: "number", required: true },
  "record.losses": { label: "Losses", type: "number", required: true },
  "record.draws": { label: "Draws", type: "number", required: true },
  "record.kos": { label: "KOs", type: "number", required: true },

  "media.mainHighlightsUrl": { label: "Main highlights URL", type: "url" },

  "contact.businessEmail": { label: "Business email", type: "email", required: true },
  "contact.bookingUrlOrEmail": { label: "Booking URL / email", type: "urlOrEmail" },

  "socials.youtube": { label: "YouTube", type: "urlOrHandle" },
  "socials.instagram": { label: "Instagram", type: "urlOrHandle" },
  "socials.tiktok": { label: "TikTok", type: "urlOrHandle" },
  "socials.x": { label: "X", type: "urlOrHandle" },
  "socials.facebook": { label: "Facebook", type: "urlOrHandle" },
  "socials.twitch": { label: "Twitch", type: "urlOrHandle" },
  "socials.threads": { label: "Threads", type: "urlOrHandle" },
  "socials.linkedin": { label: "LinkedIn", type: "urlOrHandle" },
  "socials.snapchat": { label: "Snapchat", type: "urlOrHandle" },
  "socials.website": { label: "Website", type: "url" },
};

// Array fields are validated with minimum-row rules, not per-field types.
export const ARRAY_FIELDS: Record<string, "fights" | "highlights" | "sponsors"> = {
  "record.fights": "fights",
  "media.highlights": "highlights",
  "sponsors": "sponsors",
};

export function fieldType(path: string): CanonicalType | undefined {
  return CANONICAL_PROFILE_FIELDS[path]?.type;
}

// Which Website-data-table section a path belongs to (derived from its prefix).
const SECTION_MAP: Record<string, string> = {
  identity: "Identity",
  bio: "Bio",
  vitals: "Vitals",
  record: "Record",
  media: "Media",
  contact: "Contact",
  socials: "Socials",
  sponsors: "Sponsors",
};
export function tableSection(path: string): string {
  return SECTION_MAP[path.split(".")[0]] ?? path.split(".")[0];
}

// Natural spoken variants the extractor should recognise as intent for a field.
export const FIELD_INTENT_ALIASES: Record<string, string[]> = {
  "identity.fullName": ["my name is", "my full name is", "fighter full name", "legal name"],
  "identity.displayName": ["display name", "go by", "known as"],
  "identity.nickname": ["my nickname is", "they call me", "fight name", "ring name"],
  "identity.tagline": ["my tagline is", "my motto is", "my slogan is"],
  "vitals.fightingWeight": ["fight weight", "fighting weight", "i fight at", "i compete at", "i weigh in at"],
  "vitals.division": ["my division is", "i am a", "weight class"],
  "record.wins": ["wins", "won"],
  "record.losses": ["losses", "lost"],
  "record.draws": ["draws", "drawn"],
  "record.kos": ["knockouts", "kos", "kayos"],
  "contact.businessEmail": ["business enquiries email", "business inquiries email", "contact email", "email for enquiries"],
  "contact.bookingUrlOrEmail": ["booking goes to", "book me at", "booking email", "booking link"],
  "socials.youtube": ["my youtube is", "youtube channel"],
  "socials.instagram": ["my instagram is", "insta", "ig"],
  "socials.tiktok": ["my tiktok is", "tiktok"],
  "socials.website": ["my website is", "website"],
  "sponsors": ["my sponsors are", "sponsored by", "my partners are"],
};
