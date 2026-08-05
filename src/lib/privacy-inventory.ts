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
    retention:
      "Until you delete your account. Deletion is immediate and permanent for your account and personal data. ONE EXCEPTION, stated plainly: discussion you posted stays on the thread it belongs to, re-attributed to \"Deleted User\" — removing it outright would delete the replies other people wrote underneath it. Your name, handle, photo and every other identifier are severed from it.",
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
    retention:
      "Until you delete it. Deleting your ACCOUNT does not delete posts you have already published: they are kept and re-attributed to \"Deleted User\", because deleting a thread would take every reply inside it — other people's writing — with it. Reactions, bookmarks and subscriptions are deleted outright.",
    source: "prisma/schema.prisma — ForumThread, ForumPost; src/lib/account/tombstone.ts",
  },
  {
    category: "Private messages",
    data: "The text of direct messages you send, who they were sent to, when they were sent and read, and which conversations you have archived.",
    purpose: "To deliver your messages and show you what is unread.",
    lawfulBasis: "Contract — the feature cannot work otherwise.",
    retention:
      "Until you delete your account, which deletes the messages you sent. NOT END-TO-END ENCRYPTED: they are stored in our database and, like any other content, are readable by an administrator with database access. Do not send anything you would not put in an email. We do not scan them for advertising and never sell them.",
    source: "prisma/schema.prisma — Conversation, ConversationMember, DirectMessage",
  },
  {
    category: "Predictions and picks",
    data: "The fighter you picked in each bout, optionally how you think it ends, when you picked, whether it was correct, your streaks, accuracy and leaderboard position, and any head-to-head battles you enter. (A 1–5 confidence rating was collected previously; the control was removed and nothing new records it. Values on older picks are retained and still shown to you.)",
    purpose: "To score your predictions and rank them against other people's.",
    lawfulBasis: "Contract — this is the core of the service.",
    retention:
      "Until you delete your account. PUBLIC BY DEFAULT: your picks, accuracy and leaderboard position are visible to anyone under the display name you choose. NO MONEY IS STAKED and no gambling takes place — picks score points only.",
    source: "prisma/schema.prisma — FightPick, Prediction, Battle",
  },
  {
    category: "Location on the community map",
    data:
      "An approximate pin you place YOURSELF, a visibility setting, and check-ins you make at a gym or event. We do NOT read your device's GPS, we do not ask for the browser location permission, and we never track you in the background.",
    purpose: "To show people and gyms near you on the community map.",
    lawfulBasis: "Consent — the map is HIDDEN by default and stays hidden until you turn it on.",
    retention:
      "Until you change your visibility or delete your account. Set visibility back to hidden and the pin stops being published immediately. A pin you place yourself is the point of the design: a precise device location is not collected, so it cannot leak.",
    source: "prisma/schema.prisma — User.mapVisibility/mapLat/mapLng, CheckIn",
  },
  {
    category: "Follows and favourites",
    data: "The people you follow, who follows you, and the fighters, events and promotions you favourite.",
    purpose: "To build your feed and notify you about what you follow.",
    lawfulBasis: "Contract / legitimate interests.",
    retention: "Until you unfollow or delete your account. Follower and following counts are public.",
    source: "prisma/schema.prisma — UserFollow, FavoriteFighter, FavoritePromotion, FavoriteEvent",
  },
  {
    category: "Notifications",
    data:
      "Notifications generated for you, and — only if you turn on push — the subscription your BROWSER issues: an endpoint URL at your browser vendor plus two encryption keys.",
    purpose: "To tell you when a fight you follow is resolved or someone replies to you.",
    lawfulBasis: "Consent for push (your browser asks first, and you may refuse). Legitimate interests for in-app notifications.",
    retention:
      "Deleted when you disable push, when the browser vendor reports the subscription as expired, or when you delete your account. A push subscription is bound to that one browser and cannot be used to identify you elsewhere.",
    source: "prisma/schema.prisma — Notification, PushSubscription; src/lib/push/send.ts",
  },
  {
    category: "Usage analytics",
    data:
      "Aggregate events — pages viewed, predictions made, follows — linked to your account id when you are signed in, and to NO identifier at all when you are not.",
    purpose: "To understand which parts of the site are used and what is broken.",
    lawfulBasis: "Legitimate interests — improving the service.",
    retention:
      "FIRST-PARTY AND COOKIELESS: stored in our own database, no third-party analytics script, no advertising identifier, nothing written to your device. It is never sold or shared.",
    source: "prisma/schema.prisma — AnalyticsEvent",
  },
  {
    category: "Moderation and reports",
    data: "Reports you make or that are made about your content, moderator decisions, and the moderator audit trail (who acted, when, on what).",
    purpose: "To keep the community safe and to allow appeals.",
    lawfulBasis: "Legitimate interests — running a safe platform.",
    retention: "Kept while needed to handle the report and any appeal.",
    source: "prisma/schema.prisma — ForumReport, CopyrightReport, AuditLog; src/lib/moderation/reports.ts",
  },
  {
    // Added when automated screening shipped. Content is inspected BEFORE it is
    // stored, which is processing that a reader is entitled to know about — and
    // the honest framing matters: it is a rule check on the text of the post,
    // not profiling, and it produces no decision about the PERSON.
    category: "Automated content screening",
    data:
      "The text of a post, thread title or comment is checked against a fixed set of rules at the moment you submit it. The check runs in memory on our own servers, is not sent anywhere else, and nothing about the check is stored when the content passes.",
    purpose:
      "To stop slurs, incitement against a group, and spam being published. Ordinary swearing is explicitly permitted and is not screened.",
    lawfulBasis: "Legitimate interests — running a safe platform.",
    retention:
      "Nothing is retained. A blocked post is never written to the database; you are shown a message and your text stays in the box for you to edit. There is no automated decision-making about you as a person, no profiling, and no consequence to your account from a blocked post.",
    source: "src/lib/moderation/text/",
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
    name: "CARTO / OpenStreetMap",
    role: "Map tiles for the community map",
    location: "EU / US",
    dataSent:
      "Your IP address and the map area you are looking at — sent by YOUR BROWSER directly to the tile server, as any image request is. We send them nothing about you, and no pin or account id is included.",
    active: true,
    note: "Only when you open the map. Every other page loads no tiles and contacts them not at all.",
  },
  {
    name: "flagcdn.com",
    role: "Country flag images",
    location: "US",
    dataSent: "Your IP address, as with any externally-hosted image.",
    active: true,
  },
  {
    name: "Your browser vendor's push service (Google, Mozilla, Apple or Microsoft)",
    role: "Delivering push notifications",
    location: "Global",
    dataSent:
      "The notification, to the endpoint YOUR BROWSER issued. Only if you enable push. The message body is encrypted to keys held by your browser, so the push service relays it without being able to read it.",
    active: true,
    note: "We do not choose this processor — your browser does, by issuing the endpoint.",
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
 * Product analytics are FIRST-PARTY and COOKIELESS: a server-side event log
 * (AnalyticsEvent) records aggregate usage — pageviews, predictions, follows —
 * keyed to your account id only when you are signed in, and to no identifier at
 * all when you are not. It sets NO cookie and writes NOTHING to your device, uses
 * NO third-party script, and the package manifest carries no analytics/marketing
 * dependency. Because nothing optional is stored on your device, PECR requires no
 * consent banner — the cookie list below is unchanged. We say so plainly rather
 * than adding a decorative banner that consents to nothing.
 */
export const COOKIES: CookieEntry[] = [
  {
    name: "cr_session",
    category: "strictly-necessary",
    purpose: "Keeps you signed in. httpOnly, so JavaScript cannot read it; Secure in production; SameSite=Lax.",
    provider: "Combat Reviews (first-party)",
    retention: "30 days, or until you sign out.",
  },
  {
    name: "locale",
    category: "preferences",
    purpose: "Remembers your chosen language.",
    provider: "Combat Reviews (first-party)",
    retention: "Until you change or clear it.",
  },
];

export const hasOptionalCookies = () =>
  COOKIES.some((c) => c.category === "analytics" || c.category === "marketing");
