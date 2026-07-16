// ════════════════════════════════════════════════════════════════════════
//  Privacy data inventory — the SINGLE SOURCE for the privacy notice.
//
//  The /privacy page is rendered from this list, so the notice cannot drift away
//  from the code. If a processor is removed, delete the row and the policy stops
//  claiming it. If one is added and this list is not updated, that is a bug — and
//  it is the kind of bug that makes a privacy notice false.
//
//  Every entry below was traced from the code, not from a template.
// ════════════════════════════════════════════════════════════════════════

export interface DataCategory {
  category: string;
  /** What we actually hold. */
  data: string;
  purpose: string;
  lawfulBasis: string;
  retention: string;
  /** Where in the code this lives — keeps the inventory checkable. */
  source: string;
}

export const DATA_CATEGORIES: DataCategory[] = [
  {
    category: "Account",
    data: "Name, email address, username, password (hashed with bcrypt — never stored in readable form), chosen role.",
    purpose: "To create and operate your account.",
    lawfulBasis: "Contract — we cannot give you an account without it.",
    retention: "Until you delete your account. Deletion is immediate and permanent.",
    source: "prisma/schema.prisma — User",
  },
  {
    category: "Sessions & security",
    data: "A signed session cookie, a session-version counter, sign-in rate-limit counters, and password-reset tokens (stored only as a SHA-256 hash).",
    purpose: "To keep you signed in and to detect and slow down attacks on accounts.",
    lawfulBasis: "Legitimate interests — securing the service.",
    retention: "Sessions expire after 30 days. Reset tokens expire in 30 minutes and are single-use; dead tokens are purged after 7 days.",
    source: "src/lib/auth.ts, src/lib/auth-password-reset.ts",
  },
  {
    category: "Identity-verification documents",
    data: "The passport, driving licence, ID card or federation licence you upload when you claim a fighter profile.",
    purpose: "Solely to verify that you are who you say you are before we hand you control of a profile.",
    lawfulBasis: "Consent — you choose to claim a profile. You can withdraw by deleting the claim or your account.",
    retention:
      "Stored PRIVATELY, never publicly. Deleted from storage immediately once your claim is approved; 14 days after a rejection (an appeal window); 30 days if the claim is abandoned; and immediately if you delete your account. Deletion removes the file itself, not just the database record.",
    source: "src/lib/evidence/*, docs/SECURITY-IDENTITY-EVIDENCE.md",
  },
  {
    category: "Voice recordings and transcripts",
    data: "Audio you record in the voice-to-profile feature, the transcript of it, and the profile fields extracted from it.",
    purpose: "To fill in your fighter profile from what you said.",
    lawfulBasis: "Consent — you must explicitly agree before recording, and the feature is off unless you use it.",
    retention:
      "The audio is NOT stored on our servers: it is held in memory for the length of the request and then discarded. Transcripts and extracted fields are shown back to you for confirmation and are not retained unless you save them to your profile.",
    source: "src/app/api/voicebuild/*, src/lib/voicebuild/guard.server.ts",
  },
  {
    category: "Community content",
    data: "Forum threads, posts, reactions, and any community activity.",
    purpose: "To run the community.",
    lawfulBasis: "Contract / legitimate interests.",
    retention: "Until you delete it or your account.",
    source: "prisma/schema.prisma — ForumThread, ForumPost",
  },
  {
    category: "Moderation and reports",
    data: "Reports you make or that are made about your content, and moderator decisions.",
    purpose: "To keep the community safe and to allow appeals.",
    lawfulBasis: "Legitimate interests — running a safe platform.",
    retention: "Kept while needed to handle the report and any appeal.",
    source: "prisma/schema.prisma — ForumReport, CopyrightReport",
  },
  {
    category: "Audit logs",
    data: "Records of security-relevant actions: sign-ins, password changes, claim decisions, admin actions, and every time a reviewer opens an identity document.",
    purpose: "Security, accountability, and being able to tell you who looked at your ID.",
    lawfulBasis: "Legal obligation and legitimate interests.",
    retention: "Metadata only — never the contents of a document, a transcript, or a password.",
    source: "prisma/schema.prisma — AuditLog",
  },
];

export interface Processor {
  name: string;
  role: string;
  location: string;
  dataSent: string;
  /** Whether this processor receives data in the CURRENT configuration. */
  active: boolean;
  note?: string;
}

/**
 * Third parties who may receive personal data.
 *
 * `active: false` means the feature is switched off in the current configuration, so
 * nothing is being sent. They are still listed — an honest notice says what MAY
 * happen if a feature is enabled, and hiding a disabled processor would mean the
 * notice silently becomes wrong the day it is turned on.
 */
export const PROCESSORS: Processor[] = [
  {
    name: "Render / Vercel",
    role: "Hosting and application infrastructure",
    location: "EU / US",
    dataSent: "Everything the application processes, as its host.",
    active: true,
  },
  {
    name: "PostgreSQL database (managed by our host)",
    role: "Primary data store",
    location: "EU / US",
    dataSent: "Account, community and moderation data.",
    active: true,
  },
  {
    name: "Cloudflare R2",
    role: "Private object storage",
    location: "EU / US",
    dataSent: "Identity-verification documents (private bucket, never publicly readable).",
    active: true,
  },
  {
    name: "Resend",
    role: "Transactional email",
    location: "US",
    dataSent: "Your email address, to send password-reset links.",
    active: true,
  },
  {
    name: "Deepgram",
    role: "Speech-to-text",
    location: "US",
    dataSent: "The audio you record in the voice-to-profile feature.",
    active: false,
    note: "The voice feature is currently DISABLED. Nothing is sent to Deepgram unless it is switched on and you use it, having first given consent.",
  },
  {
    name: "OpenAI",
    role: "Speech-to-text and/or text extraction",
    location: "US",
    dataSent: "Your recording and/or its transcript.",
    active: false,
    note: "The voice feature is currently DISABLED.",
  },
  {
    name: "xAI",
    role: "Text extraction from a transcript",
    location: "US",
    dataSent: "The transcript of your recording.",
    active: false,
    note: "The voice feature is currently DISABLED.",
  },
];

export const activeProcessors = () => PROCESSORS.filter((p) => p.active);

export interface CookieEntry {
  name: string;
  category: "strictly-necessary" | "preferences" | "analytics" | "marketing";
  purpose: string;
  provider: string;
  retention: string;
}

/**
 * Every cookie and client-side store the application sets.
 *
 * There is currently NO analytics, NO marketing pixel, and NO third-party script:
 * the package manifest contains no analytics dependency and the layout loads no
 * external script. That is why there is no consent banner — under PECR, a banner is
 * required for optional cookies, and there are none. We say so plainly rather than
 * adding a decorative banner that consents to nothing.
 */
export const COOKIES: CookieEntry[] = [
  {
    name: "cr_session",
    category: "strictly-necessary",
    purpose: "Keeps you signed in. httpOnly, so JavaScript cannot read it; Secure in production; SameSite=Lax.",
    provider: "Combat Register (first-party)",
    retention: "30 days, or until you sign out.",
  },
  {
    name: "locale",
    category: "preferences",
    purpose: "Remembers your chosen language.",
    provider: "Combat Register (first-party)",
    retention: "Until you change or clear it.",
  },
];

export const hasOptionalCookies = () =>
  COOKIES.some((c) => c.category === "analytics" || c.category === "marketing");
