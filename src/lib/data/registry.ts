// ════════════════════════════════════════════════════════════════════════
//  Combat-sports ecosystem registry — the canonical "spine" of organisations.
//
//  These are real, verifiable governing bodies. Each carries a source URL
//  (the official member directory / homepage) so every claim is traceable —
//  the same evidence model that gym/promoter/venue rows derive from data.
//
//  Confidence scale (per the registry design):
//    100 = official regulator / commission / federation
//     90 = official promoter / event owner
//     80 = structured database   70 = established media
//
//  National member federations are NOT hard-coded here — they are ingested
//  from each international body's official member directory (linked below) so
//  the list stays real and complete rather than guessed.
// ════════════════════════════════════════════════════════════════════════

export type OrgType =
  | "sanctioning" // title-sanctioning body
  | "federation"  // international/national governing body
  | "commission"  // athletic commission / regulator
  | "promotion"   // promoter / event owner
  | "gym"         // gym / academy
  | "venue"       // arena / venue
  | "media";      // broadcaster / outlet

export type VerificationStatus = "verified" | "official" | "unverified" | "claimed";

// Provenance taxonomy for every registry row.
export type SourceType =
  | "infrastructure"
  | "governing_body"
  | "national_federation"
  | "promoter"
  | "commission"
  | "data_reference"
  | "news_rss";

// Continental grouping for federations; "Global" for international bodies.
export type Region = "Global" | "Africa" | "Asia" | "Europe" | "Oceania" | "Panamerica";

export interface RegistryOrg {
  id: string;
  name: string;
  type: OrgType;
  sports: string[];          // human-readable sport labels
  jurisdiction?: string;     // country / "International"
  website?: string;
  /** Official member-directory or canonical source URL. */
  sourceUrl?: string;
  confidence: number;        // 0..100
  status: VerificationStatus;
  sourceType?: SourceType;
  region?: Region;
  note?: string;
}

// ── International governing bodies — the canonical spine ──────────────────
// Source = each body's official member-federation directory, the canonical
// index for ingesting every national federation per sport.
export const GOVERNING_BODIES: RegistryOrg[] = [
  // Boxing — sanctioning
  { id: "wba", name: "World Boxing Association", type: "sanctioning", sports: ["Boxing"], jurisdiction: "International", website: "https://www.wbaboxing.com", confidence: 100, status: "official" },
  { id: "wbc", name: "World Boxing Council", type: "sanctioning", sports: ["Boxing"], jurisdiction: "International", website: "https://wbcboxing.com", confidence: 100, status: "official" },
  { id: "ibf", name: "International Boxing Federation", type: "sanctioning", sports: ["Boxing"], jurisdiction: "International", website: "https://www.ibf-usba-boxing.com", confidence: 100, status: "official" },
  { id: "wbo", name: "World Boxing Organization", type: "sanctioning", sports: ["Boxing"], jurisdiction: "International", website: "https://www.wboboxing.com", confidence: 100, status: "official" },
  { id: "ring", name: "The Ring Magazine", type: "media", sports: ["Boxing"], jurisdiction: "International", website: "https://www.ringtv.com", confidence: 70, status: "official" },

  // MMA
  { id: "immaf", name: "International Mixed Martial Arts Federation (IMMAF)", type: "federation", sports: ["MMA"], jurisdiction: "International", website: "https://immaf.org", sourceUrl: "https://immaf.org/membership/our-members/", confidence: 100, status: "official", note: "≈140 national federations — member directory is the ingestion spine." },

  // Muay Thai
  { id: "ifma", name: "International Federation of Muaythai Associations (IFMA)", type: "federation", sports: ["Muay Thai"], jurisdiction: "International", website: "https://muaythai.sport", sourceUrl: "https://muaythai.sport/members/", confidence: 100, status: "official", note: "≈140 national federations." },

  // Kickboxing
  { id: "wako", name: "World Association of Kickboxing Organizations (WAKO)", type: "federation", sports: ["Kickboxing"], jurisdiction: "International", website: "https://wako.sport", sourceUrl: "https://wako.sport/members/", confidence: 100, status: "official", note: "≈130 national federations." },

  // Sambo
  { id: "fias", name: "International Sambo Federation (FIAS)", type: "federation", sports: ["Sambo", "Combat Sambo"], jurisdiction: "International", website: "https://sambo.sport", sourceUrl: "https://sambo.sport/en/members/", confidence: 100, status: "official", note: "≈120 national federations." },

  // Judo
  { id: "ijf", name: "International Judo Federation (IJF)", type: "federation", sports: ["Judo"], jurisdiction: "International", website: "https://www.ijf.org", sourceUrl: "https://www.ijf.org/countries", confidence: 100, status: "official", note: "205 national federations — full directory available." },

  // Taekwondo
  { id: "wt", name: "World Taekwondo (WT)", type: "federation", sports: ["Taekwondo (WT)"], jurisdiction: "International", website: "https://www.worldtaekwondo.org", sourceUrl: "https://www.worldtaekwondo.org/wtf/member.html", confidence: 100, status: "official", note: "≈210 member national associations." },
  { id: "itf", name: "International Taekwon-Do Federation (ITF)", type: "federation", sports: ["Taekwondo (ITF)"], jurisdiction: "International", website: "https://www.itftkd.sport", confidence: 100, status: "official" },

  // BJJ / grappling
  { id: "ibjjf", name: "International Brazilian Jiu-Jitsu Federation (IBJJF)", type: "federation", sports: ["BJJ (Gi)", "BJJ (No-Gi)"], jurisdiction: "International", website: "https://ibjjf.com", confidence: 100, status: "official" },
  { id: "jjif", name: "Ju-Jitsu International Federation (JJIF)", type: "federation", sports: ["BJJ", "Ju-Jitsu"], jurisdiction: "International", website: "https://jjif.org", sourceUrl: "https://jjif.org/members/", confidence: 100, status: "official" },
  { id: "uww", name: "United World Wrestling (UWW)", type: "federation", sports: ["Grappling", "Wrestling"], jurisdiction: "International", website: "https://uww.org", confidence: 100, status: "official" },
];

// ── Athletic commissions — regulators (real, partial — they don't sit in a
//    single global index, so we list the ones that meaningfully exist). ────
export const COMMISSIONS: RegistryOrg[] = [
  { id: "nsac", name: "Nevada State Athletic Commission", type: "commission", sports: ["Boxing", "MMA"], jurisdiction: "USA — Nevada", website: "https://boxing.nv.gov", confidence: 100, status: "official" },
  { id: "nysac", name: "New York State Athletic Commission", type: "commission", sports: ["Boxing", "MMA"], jurisdiction: "USA — New York", website: "https://dos.ny.gov/athletic-commission", confidence: 100, status: "official" },
  { id: "csac", name: "California State Athletic Commission", type: "commission", sports: ["Boxing", "MMA"], jurisdiction: "USA — California", website: "https://www.dca.ca.gov/csac/", confidence: 100, status: "official" },
  { id: "bbbofc", name: "British Boxing Board of Control", type: "commission", sports: ["Boxing"], jurisdiction: "United Kingdom", website: "https://bbbofc.com", confidence: 100, status: "official" },
];

export const REGISTRY_SEED: RegistryOrg[] = [...GOVERNING_BODIES, ...COMMISSIONS];

// ── National member federations ──────────────────────────────────────────
// Ingested from each international body's official member directory by
// `scripts/ingest-federations.ts` → emitted to `federations.generated.ts`.
// Never hand-authored: real or absent, by design.
export interface NationalFederation {
  id: string;          // `${bodyId}-${countrySlug}`
  name: string;        // official federation name as listed
  body: string;        // parent governing-body id (e.g. "ijf", "immaf")
  sport: string;       // human-readable sport label
  country?: string;
  region?: Region;     // continental grouping
  countryUrl?: string; // the federation's own domain, or its directory link
  sourceUrl: string;   // the member-directory URL it was read from
  sourceType: SourceType; // always "national_federation"
  fetchedAt: string;   // ISO timestamp of the ingest run
}

export const ORG_TYPE_LABEL: Record<OrgType, string> = {
  sanctioning: "Sanctioning body",
  federation: "Federation",
  commission: "Commission",
  promotion: "Promotion",
  gym: "Gym / Academy",
  venue: "Venue",
  media: "Media",
};
