// ---------------------------------------------------------------------------
// Ordered voice-onboarding questions. Each question declares the profile
// field(s) it is allowed to touch. The server builds its strict extraction
// JSON-schema from these `fields`, and the reducer maps `extracted[field.id]`
// -> `field.path`. This is the ONLY place the question order/labels live, so it
// is shared verbatim by the client UI and the server extractor.
// ---------------------------------------------------------------------------

export type FieldType =
  | "string"
  | "text"
  | "number"
  | "url"
  | "email"
  | "select"
  | "array";

export type ProfileField = {
  id: string; // key in ExtractionResult.extracted
  path: string; // dot-path into FighterProfile
  type: FieldType;
  label: string;
  options?: string[]; // for select
  itemFields?: ProfileField[]; // for arrays (object items)
};

export type Question = {
  id: string;
  order: number;
  section: string;
  title: string; // the question spoken to the fighter
  help?: string;
  required: boolean;
  kind: "fields" | "record" | "socials" | "fights" | "highlights" | "sponsors" | "gallery";
  fields: ProfileField[];
};

// Deterministic extraction contract returned by /api/extract.
export type ExtractionResult = {
  questionId: string;
  targetFields: string[];
  transcript: string;
  extracted: Record<string, unknown>;
  needsReview: boolean;
  reviewReason?: string;
};

export const QUESTIONS: Question[] = [
  {
    id: "fullName",
    order: 1,
    section: "Identity",
    title: "What's the fighter's full name?",
    help: "Legal / full name as it should appear on the profile.",
    required: true,
    kind: "fields",
    fields: [{ id: "fullName", path: "identity.fullName", type: "string", label: "Full name" }],
  },
  {
    id: "displayName",
    order: 2,
    section: "Identity",
    title: "What display name should the site use?",
    help: "The big headline name, e.g. how it appears in the hero.",
    required: true,
    kind: "fields",
    fields: [{ id: "displayName", path: "identity.displayName", type: "string", label: "Display name" }],
  },
  {
    id: "nickname",
    order: 3,
    section: "Identity",
    title: "Any nickname or brand name?",
    help: "Optional ring name / brand, e.g. \"KK\".",
    required: false,
    kind: "fields",
    fields: [{ id: "nickname", path: "identity.nickname", type: "string", label: "Nickname" }],
  },
  {
    id: "role",
    order: 4,
    section: "Identity",
    title: "What's the role or discipline?",
    help: "e.g. Professional Boxer, MMA Fighter.",
    required: true,
    kind: "fields",
    fields: [{ id: "role", path: "identity.role", type: "string", label: "Role / discipline" }],
  },
  {
    id: "tagline",
    order: 5,
    section: "Identity",
    title: "Give me a one-line tagline.",
    help: "Short, punchy. e.g. \"The handsome Scotsman.\"",
    required: true,
    kind: "fields",
    fields: [{ id: "tagline", path: "identity.tagline", type: "string", label: "Tagline" }],
  },
  {
    id: "division",
    order: 6,
    section: "Vitals",
    title: "What division / weight class? (optional — derived from weight later)",
    required: false,
    kind: "fields",
    fields: [{ id: "division", path: "vitals.division", type: "string", label: "Division" }],
  },
  {
    id: "nationality",
    order: 7,
    section: "Vitals",
    title: "What's the fighter's nationality?",
    required: true,
    kind: "fields",
    fields: [{ id: "nationality", path: "vitals.nationality", type: "string", label: "Nationality" }],
  },
  {
    id: "residence",
    order: 8,
    section: "Vitals",
    title: "Where do they currently live?",
    required: false,
    kind: "fields",
    fields: [{ id: "residence", path: "vitals.residence", type: "string", label: "Residence" }],
  },
  {
    id: "birthplace",
    order: 9,
    section: "Vitals",
    title: "Where were they born?",
    required: false,
    kind: "fields",
    fields: [{ id: "birthplace", path: "vitals.birthplace", type: "string", label: "Birthplace" }],
  },
  {
    id: "ageDob",
    order: 10,
    section: "Vitals",
    title: "How old are they, or what's their date of birth?",
    help: "Give an age and/or a date of birth.",
    required: false,
    kind: "fields",
    fields: [
      { id: "age", path: "vitals.age", type: "number", label: "Age" },
      { id: "dateOfBirth", path: "vitals.dateOfBirth", type: "string", label: "Date of birth" },
    ],
  },
  {
    id: "debutDate",
    order: 11,
    section: "Vitals",
    title: "When did they turn pro / debut?",
    required: false,
    kind: "fields",
    fields: [{ id: "debutDate", path: "vitals.debutDate", type: "string", label: "Debut date" }],
  },
  {
    id: "careerSpan",
    order: 12,
    section: "Vitals",
    title: "What's the career span?",
    help: "e.g. \"2024–Ongoing\".",
    required: false,
    kind: "fields",
    fields: [{ id: "careerSpan", path: "vitals.careerSpan", type: "string", label: "Career span" }],
  },
  {
    id: "record",
    order: 13,
    section: "Record",
    title: "What's the professional record — wins, losses, draws and KOs?",
    help: "Say all four numbers.",
    required: true,
    kind: "record",
    fields: [
      { id: "wins", path: "record.wins", type: "number", label: "Wins" },
      { id: "losses", path: "record.losses", type: "number", label: "Losses" },
      { id: "draws", path: "record.draws", type: "number", label: "Draws" },
      { id: "kos", path: "record.kos", type: "number", label: "KOs" },
    ],
  },
  {
    id: "bouts",
    order: 14,
    section: "Record",
    title: "How many total bouts?",
    required: false,
    kind: "fields",
    fields: [{ id: "bouts", path: "vitals.bouts", type: "number", label: "Bouts" }],
  },
  {
    id: "rounds",
    order: 15,
    section: "Record",
    title: "How many total rounds?",
    required: false,
    kind: "fields",
    fields: [{ id: "rounds", path: "vitals.rounds", type: "number", label: "Rounds" }],
  },
  {
    id: "koRate",
    order: 16,
    section: "Record",
    title: "What's the KO rate?",
    help: "e.g. \"60%\".",
    required: false,
    kind: "fields",
    fields: [{ id: "koRate", path: "vitals.koRate", type: "string", label: "KO rate" }],
  },
  {
    id: "ranking",
    order: 17,
    section: "Record",
    title: "Any ranking to include?",
    help: "National / governing-body ranking, if available.",
    required: false,
    kind: "fields",
    fields: [{ id: "ranking", path: "vitals.ranking", type: "string", label: "Ranking" }],
  },
  {
    id: "bio",
    order: 18,
    section: "Bio",
    title: "Give me a short bio — a paragraph about the fighter.",
    help: "Speak naturally; we'll capture the paragraph and a short headline.",
    required: true,
    kind: "fields",
    fields: [
      { id: "aboutHeadline", path: "bio.aboutHeadline", type: "string", label: "About headline" },
      { id: "aboutBody", path: "bio.aboutBody", type: "text", label: "About paragraph" },
    ],
  },
  {
    id: "fights",
    order: 19,
    section: "Record",
    title: "Walk through the fight record — date, opponent, result, method, round, location.",
    help: "List one or more fights; each becomes a row.",
    required: false,
    kind: "fights",
    fields: [
      {
        id: "fights",
        path: "record.fights",
        type: "array",
        label: "Fights",
        itemFields: [
          { id: "date", path: "date", type: "string", label: "Date" },
          { id: "opponent", path: "opponent", type: "string", label: "Opponent" },
          { id: "result", path: "result", type: "string", label: "Result" },
          { id: "method", path: "method", type: "string", label: "Method" },
          { id: "round", path: "round", type: "string", label: "Round" },
          { id: "location", path: "location", type: "string", label: "Location" },
        ],
      },
    ],
  },
  {
    id: "highlights",
    order: 20,
    section: "Media",
    title: "Highlight video links — Knockout Reel, Best Combinations, Full Fight, and a main highlights video.",
    help: "Give titles and URLs; the main highlights video is captured separately.",
    required: false,
    kind: "highlights",
    fields: [
      {
        id: "highlights",
        path: "media.highlights",
        type: "array",
        label: "Highlight clips",
        itemFields: [
          { id: "title", path: "title", type: "string", label: "Title" },
          { id: "url", path: "url", type: "url", label: "URL" },
        ],
      },
      { id: "mainHighlightsUrl", path: "media.mainHighlightsUrl", type: "url", label: "Main highlights URL" },
    ],
  },
  {
    id: "socials",
    order: 21,
    section: "Socials",
    title: "Social links — YouTube, Instagram, TikTok, X, Facebook, Twitch, Threads, LinkedIn, Snapchat, website.",
    help: "Mention any platforms with their handles or URLs.",
    required: false,
    kind: "socials",
    fields: [
      { id: "youtube", path: "socials.youtube", type: "url", label: "YouTube" },
      { id: "instagram", path: "socials.instagram", type: "url", label: "Instagram" },
      { id: "tiktok", path: "socials.tiktok", type: "url", label: "TikTok" },
      { id: "x", path: "socials.x", type: "url", label: "X" },
      { id: "facebook", path: "socials.facebook", type: "url", label: "Facebook" },
      { id: "twitch", path: "socials.twitch", type: "url", label: "Twitch" },
      { id: "threads", path: "socials.threads", type: "url", label: "Threads" },
      { id: "linkedin", path: "socials.linkedin", type: "url", label: "LinkedIn" },
      { id: "snapchat", path: "socials.snapchat", type: "url", label: "Snapchat" },
      { id: "website", path: "socials.website", type: "url", label: "Website" },
    ],
  },
  {
    id: "sponsors",
    order: 22,
    section: "Sponsors",
    title: "Sponsors or partners — name, and a URL if there is one.",
    required: false,
    kind: "sponsors",
    fields: [
      {
        id: "sponsors",
        path: "sponsors",
        type: "array",
        label: "Sponsors",
        itemFields: [
          { id: "name", path: "name", type: "string", label: "Name" },
          { id: "url", path: "url", type: "url", label: "URL" },
        ],
      },
    ],
  },
  {
    id: "businessEmail",
    order: 23,
    section: "Contact",
    title: "What's the business enquiries email?",
    required: true,
    kind: "fields",
    fields: [{ id: "businessEmail", path: "contact.businessEmail", type: "email", label: "Business email" }],
  },
  {
    id: "bookingCta",
    order: 24,
    section: "Contact",
    title: "Where should the booking button go — a URL or an email?",
    required: false,
    kind: "fields",
    fields: [{ id: "bookingUrlOrEmail", path: "contact.bookingUrlOrEmail", type: "string", label: "Booking URL / email" }],
  },
  {
    id: "gallery",
    order: 25,
    section: "Gallery",
    title: "Upload gallery photos and add captions.",
    help: "Final step — add as many photos as you like.",
    required: false,
    kind: "gallery",
    fields: [],
  },
];

export const VOICE_QUESTIONS = QUESTIONS.filter((q) => q.kind !== "gallery");
export const GALLERY_QUESTION = QUESTIONS.find((q) => q.kind === "gallery")!;

export function getQuestion(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}
