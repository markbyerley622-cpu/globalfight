import type { FighterProfile } from "./fighterProfileSchema";
import { type ProfileField, type Question } from "./questionBank";
import { CANONICAL_PROFILE_FIELDS } from "./profileFields";

// ---------------------------------------------------------------------------
// Deterministic profile updates. No AI, no guessing — this just maps an
// ExtractionResult (or a manual edit) onto the canonical profile object, with
// type coercion + validation. Pure/immutable so it plays nicely with React and
// localStorage.
// ---------------------------------------------------------------------------

/** Immutable deep-set by dot path. Returns a new object. */
export function setDeep<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const clone: any = Array.isArray(obj) ? [...(obj as any)] : { ...obj };
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...(cur[k] ?? {}) };
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
}

export function getDeep(obj: unknown, path: string): unknown {
  return path.split(".").reduce<any>((acc, k) => (acc == null ? acc : acc[k]), obj);
}

// Canonical, immutable path helpers — the single way to read/write profile
// values across the table, reducer, merge and export adapter.
export function getProfileValue(profile: FighterProfile, path: string): unknown {
  return getDeep(profile, path);
}
export function setProfileValue(profile: FighterProfile, path: string, value: unknown): FighterProfile {
  return setDeep(profile, path, value);
}
export function setProfileValues(profile: FighterProfile, patch: Record<string, unknown>): FighterProfile {
  let next = profile;
  for (const [path, value] of Object.entries(patch)) next = setDeep(next, path, value);
  return next;
}

function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Coerce a raw extracted value to the field's declared type. Returns
 *  `undefined` when the value is unusable (so the caller can skip it). */
function coerceScalar(value: unknown, type: ProfileField["type"]): unknown {
  if (isEmpty(value)) return undefined;
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, n); // record/stat values must not be negative
  }
  return String(value).trim();
}

function coerceArrayItems(value: unknown, itemFields: ProfileField[]): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .map((raw) => {
      if (raw == null || typeof raw !== "object") return null;
      const row: Record<string, unknown> = {};
      for (const f of itemFields) {
        const c = coerceScalar((raw as any)[f.id], f.type);
        if (c !== undefined) row[f.id] = c;
      }
      return Object.keys(row).length ? row : null;
    })
    .filter(Boolean) as unknown[];
  return rows.length ? rows : undefined;
}

/** Apply a validated extraction (or partial manual object keyed by field id)
 *  to the profile. Only touches the question's declared fields; empty/null
 *  values are ignored (never overwrite good data with blanks). */
export function applyExtraction(
  profile: FighterProfile,
  question: Question,
  extracted: Record<string, unknown>,
): FighterProfile {
  let next = profile;
  for (const field of question.fields) {
    const raw = extracted[field.id];
    if (field.type === "array") {
      const items = coerceArrayItems(raw, field.itemFields ?? []);
      if (items) next = setDeep(next, field.path, items);
    } else {
      const val = coerceScalar(raw, field.type);
      if (val !== undefined) next = setDeep(next, field.path, val);
    }
  }
  return next;
}

// -------- validation helpers (used by the export screen) -------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidUrl(v: string): boolean {
  if (!v) return false;
  try {
    const u = new URL(v.includes("://") ? v : `https://${v}`);
    return !!u.hostname;
  } catch {
    return false;
  }
}

export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v);
}

// Apply a validated FighterProfile PATCH (from the LLM) onto the profile.
// Nested one level (identity.*, vitals.*, record.* incl. arrays, media.*,
// socials.*, contact.*) plus the top-level sponsors array. `protectedPaths`
// (manually-edited leaves) are never overwritten. Empty values are skipped.
export function mergePatch(
  profile: FighterProfile,
  patch: Record<string, unknown>,
  protectedPaths: Set<string> = new Set(),
): FighterProfile {
  let next = profile;
  for (const [section, sectionVal] of Object.entries(patch)) {
    if (sectionVal == null) continue;
    if (Array.isArray(sectionVal)) {
      if (sectionVal.length && !protectedPaths.has(section)) next = setDeep(next, section, sectionVal);
      continue;
    }
    if (typeof sectionVal !== "object") continue;
    for (const [k, v] of Object.entries(sectionVal as Record<string, unknown>)) {
      const path = `${section}.${k}`;
      if (protectedPaths.has(path)) continue;
      if (Array.isArray(v)) {
        if (v.length) next = setDeep(next, path, v);
      } else if (!isEmpty(v)) {
        next = setDeep(next, path, v);
      }
    }
  }
  return next;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Leaf paths whose value differs between two profiles (arrays compared whole).
 *  Used to record which fields the user manually edited. */
export function changedLeafPaths(a: unknown, b: unknown, prefix = ""): string[] {
  const out: string[] = [];
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      out.push(...changedLeafPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push(prefix);
  }
  return out;
}

export type Missing = { questionId: string; label: string; path: string };

/** Required fields (per the canonical registry) that are still empty/invalid. */
export function missingRequired(profile: FighterProfile): Missing[] {
  const out: Missing[] = [];
  for (const [path, spec] of Object.entries(CANONICAL_PROFILE_FIELDS)) {
    if (!spec.required) continue;
    if (path.startsWith("vitals.fightingWeight")) continue; // object-checked below
    const v = getDeep(profile, path);
    const empty = isEmpty(v) || (spec.type === "email" && !isValidEmail(String(v)));
    if (empty) out.push({ questionId: path, label: spec.label, path });
  }
  // Fighting weight is required raw data (value + unit). Division is intentionally
  // NOT required (derived later).
  const fw = getDeep(profile, "vitals.fightingWeight") as { value?: unknown; unit?: unknown } | undefined;
  const fwOk =
    fw != null && typeof fw === "object" && typeof fw.value === "number" && (fw.unit === "kg" || fw.unit === "lb");
  if (!fwOk) out.push({ questionId: "vitals.fightingWeight", label: "Fighting weight", path: "vitals.fightingWeight" });
  return out;
}
