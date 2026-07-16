// Deterministic validators. The LLM is NOT trusted to decide what is valid —
// every extracted value is re-checked here before it can become a merge
// candidate. Pure (no imports), so it's safe on client and server and in tests.

export type ValStatus = "valid" | "review" | "invalid";
export type ValResult = { status: ValStatus; value?: unknown; reason?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HANDLE_RE = /^@?[a-zA-Z0-9._]{2,30}$/;
const PLACEHOLDER_WORDS = new Set([
  "na", "n/a", "none", "nil", "unknown", "dunno", "idk", "tbd", "todo", "test",
  "placeholder", "blah", "nothing", "whatever", "stuff", "things", "etc", "asdf", "xxx",
]);
const PROFANITY = ["fuck", "shit", "bitch", "cunt", "asshole", "dick", "piss", "bastard", "wanker"];

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

export function looksPlaceholder(value: unknown): boolean {
  const s = norm(value).toLowerCase();
  if (!s) return true;
  if (/^[\W_]+$/.test(s)) return true; // punctuation only
  const words = s.split(/\s+/);
  const uniq = new Set(words);
  if (uniq.size === 1 && words.length >= 2) return true; // "blah blah blah"
  if (words.every((w) => PLACEHOLDER_WORDS.has(w))) return true;
  return false;
}

export function hasProfanity(value: unknown): boolean {
  const s = norm(value).toLowerCase();
  return PROFANITY.some((p) => new RegExp(`\\b${p}\\b`).test(s));
}

export function validateTextIntent(value: unknown): ValResult {
  const s = norm(value);
  if (!s) return { status: "invalid", reason: "Empty value." };
  if (looksPlaceholder(s)) return { status: "invalid", reason: "Placeholder / nonsense value." };
  if (hasProfanity(s)) return { status: "invalid", reason: "Unusable text." };
  return { status: "valid", value: s };
}

export function validateEmail(value: unknown): ValResult {
  const s = norm(value).replace(/\s+/g, "");
  if (!s) return { status: "invalid", reason: "Empty value." };
  if (!EMAIL_RE.test(s)) return { status: "invalid", reason: "Not a valid email address." };
  return { status: "valid", value: s.toLowerCase() };
}

function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function validateUrl(value: unknown): ValResult {
  const s = norm(value);
  if (!s) return { status: "invalid", reason: "Empty value." };
  if (looksPlaceholder(s)) return { status: "invalid", reason: "Placeholder / nonsense value." };
  const u = normalizeUrl(s);
  if (!u) return { status: "invalid", reason: "Not a valid URL." };
  return { status: "valid", value: u };
}

export function validateUrlOrEmail(value: unknown): ValResult {
  const s = norm(value);
  if (!s) return { status: "invalid", reason: "Empty value." };
  if (looksPlaceholder(s)) return { status: "invalid", reason: "Placeholder / nonsense value." };
  if (s.includes("@") && !/^https?:/i.test(s)) {
    const e = validateEmail(s);
    if (e.status === "valid") return e;
  }
  const u = validateUrl(s);
  if (u.status === "valid") return u;
  const e = validateEmail(s);
  if (e.status === "valid") return e;
  return { status: "invalid", reason: "Not a valid URL or email." };
}

export function validateSocialHandleOrUrl(platform: string, value: unknown): ValResult {
  const s = norm(value);
  if (!s) return { status: "invalid", reason: "Empty value." };
  if (looksPlaceholder(s)) return { status: "invalid", reason: "Placeholder / nonsense value." };
  if (/^https?:\/\//i.test(s) || (s.includes(".") && !/\s/.test(s))) {
    const u = normalizeUrl(s);
    if (u) return { status: "valid", value: u };
  }
  if (HANDLE_RE.test(s)) return { status: "valid", value: s.startsWith("@") ? s : `@${s}` };
  return { status: "invalid", reason: `Not a valid ${platform} handle or URL.` };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = norm(value).replace(/[, ]+/g, "");
  if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const isNonNegInt = (n: number) => Number.isInteger(n) && n >= 0;

export function validateNumber(value: unknown): ValResult {
  const n = toNumber(value);
  if (n == null || n < 0) return { status: "invalid", reason: "Must be a non-negative number." };
  return { status: "valid", value: n };
}

export function validateRecordValue(value: unknown): ValResult {
  const n = toNumber(value);
  if (n == null || !isNonNegInt(n)) return { status: "invalid", reason: "Must be a non-negative whole number." };
  if (n > 2000) return { status: "review", value: n, reason: "Unusually large — confirm." };
  return { status: "valid", value: n };
}

export function validateBouts(value: unknown): ValResult {
  const n = toNumber(value);
  if (n == null || !isNonNegInt(n)) return { status: "invalid", reason: "Must be a non-negative whole number." };
  if (n > 300) return { status: "review", value: n, reason: "Over 300 bouts — confirm." };
  return { status: "valid", value: n };
}

export function validateRounds(value: unknown): ValResult {
  const n = toNumber(value);
  if (n == null || !isNonNegInt(n)) return { status: "invalid", reason: "Must be a non-negative whole number." };
  if (n > 3000) return { status: "review", value: n, reason: "Over 3000 rounds — confirm." };
  return { status: "valid", value: n };
}

export function validateFightingWeight(fw: unknown, opts: { manualConfirmed?: boolean } = {}): ValResult {
  if (!fw || typeof fw !== "object") return { status: "invalid", reason: "Missing weight." };
  const value = toNumber((fw as { value?: unknown }).value);
  const unit = (fw as { unit?: unknown }).unit;
  if (value == null || value <= 0) return { status: "invalid", reason: "Missing or invalid weight value." };
  if (unit !== "kg" && unit !== "lb") return { status: "review", value: { value, unit }, reason: "Missing kg / lb unit." };
  const [lo, hi] = unit === "kg" ? [25, 250] : [55, 550];
  if (!opts.manualConfirmed && (value < lo || value > hi)) {
    return { status: "review", value: { value, unit }, reason: `Implausible weight (${value} ${unit}).` };
  }
  return { status: "valid", value: { value, unit } };
}

// Cross-field record check (individual values use validateRecordValue).
export function validateBoxingRecord(record: { wins?: unknown; kos?: unknown }): ValResult {
  const wins = toNumber(record.wins);
  const kos = toNumber(record.kos);
  if (wins != null && kos != null && kos > wins) return { status: "review", reason: "KOs exceed wins." };
  return { status: "valid" };
}

// Dates / periods. Rejects implausible spans like "one hundred years ago" and
// years far outside a plausible fighting career.
export function validateDateish(value: unknown): ValResult {
  const s = norm(value);
  if (!s) return { status: "invalid", reason: "Empty value." };
  if (looksPlaceholder(s)) return { status: "invalid", reason: "Placeholder / nonsense value." };
  if (/\b(hundred|thousand|million|billion)\b[\s\w]*\byears?\b/i.test(s) || /\b\d{3,}\s*years?\s*ago\b/i.test(s)) {
    return { status: "invalid", reason: "Implausible date / period." };
  }
  const year = s.match(/\b(19|20)\d{2}\b/);
  if (year) {
    const y = Number(year[0]);
    if (y < 1950 || y > 2035) return { status: "review", value: s, reason: "Year outside the expected range." };
  }
  return { status: "valid", value: s };
}

// True when a spoken "record" phrase is ambiguous — e.g. "ten ten ten ten ten"
// (5+ bare numbers, no wins/losses/draws/KO labels). Such phrases must NOT be
// applied as a clean W/L/D/KO record.
const RECORD_LABEL_RE = /\b(wins?|won|losses|lost|loss|draws?|drawn|kos?|knockouts?|k\.?o\.?s?)\b/i;
const NUMBER_TOKEN_RE = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|\d+)\b/gi;
export function recordPhraseIsAmbiguous(transcript: unknown): boolean {
  const s = norm(transcript).toLowerCase();
  const idx = s.indexOf("record");
  if (idx === -1) return false;
  const seg = s.slice(idx, idx + 140);
  const numbers = seg.match(NUMBER_TOKEN_RE) || [];
  return numbers.length >= 5 && !RECORD_LABEL_RE.test(seg);
}

// Minimum-row rules — drop empty / insufficient array rows so no blank fights,
// clips or sponsors are ever created.
export function validateArrayRows(
  kind: "fights" | "highlights" | "sponsors",
  arr: unknown,
): { rows: Record<string, unknown>[]; dropped: number } {
  if (!Array.isArray(arr)) return { rows: [], dropped: 0 };
  const rows: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") {
      dropped++;
      continue;
    }
    const r = raw as Record<string, unknown>;
    let ok = false;
    if (kind === "fights") {
      const opp = norm(r.opponent);
      const other = [r.date, r.result, r.method, r.location].some((v) => norm(v) !== "");
      ok = opp !== "" && !looksPlaceholder(opp) && other;
    } else if (kind === "highlights") {
      const title = norm(r.title);
      const urlOk = validateUrl(r.url).status === "valid";
      ok = (title !== "" && !looksPlaceholder(title)) || urlOk;
    } else {
      const name = norm(r.name);
      ok = name !== "" && !looksPlaceholder(name);
    }
    if (ok) rows.push(r);
    else dropped++;
  }
  return { rows, dropped };
}
