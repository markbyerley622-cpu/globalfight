import type { FighterProfile } from "../fighterProfileSchema";
import type { FighterProfileExtractionResult } from "../schemas/extractionResultSchema";
import { ARRAY_FIELDS, CANONICAL_PROFILE_FIELDS, type CanonicalType } from "../profileFields";
import { getDeep, setDeep } from "../profileReducer";
import * as V from "./profileValidation";

// Turns an LLM extraction into typed, validated, deterministic merge candidates.
// The UI applies ONLY `applyByDefault` candidates on "Accept & apply"; everything
// else (review / conflict / invalid) stays visible with a reason and can be
// applied one-by-one. Nothing invalid is ever applied.

export type Confidence = "high" | "medium" | "low";
export type MergeCandidate = {
  fieldPath: string;
  label: string;
  currentValue: unknown;
  extractedValue: unknown;
  rawEvidence: string;
  confidence: Confidence;
  validationStatus: "valid" | "review" | "invalid" | "conflict";
  applyByDefault: boolean;
  reason?: string;
};

function patchGet(patch: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k]), patch);
}
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function validateByType(path: string, type: CanonicalType, value: unknown): V.ValResult {
  switch (type) {
    case "email":
      return V.validateEmail(value);
    case "url":
      return V.validateUrl(value);
    case "urlOrEmail":
      return V.validateUrlOrEmail(value);
    case "urlOrHandle":
      return V.validateSocialHandleOrUrl(path.split(".").pop() || "social", value);
    case "dateish":
      return V.validateDateish(value);
    case "number":
      if (path === "vitals.bouts") return V.validateBouts(value);
      if (path === "vitals.rounds") return V.validateRounds(value);
      if (path.startsWith("record.")) return V.validateRecordValue(value);
      return V.validateNumber(value);
    default:
      return V.validateTextIntent(value); // string | longText | enum
  }
}

function makeCandidate(
  profile: FighterProfile,
  manualPaths: Set<string>,
  path: string,
  label: string,
  raw: unknown,
  val: V.ValResult,
  confidence: Confidence,
  evidence: string,
  needsReview: boolean,
): MergeCandidate {
  const current = getDeep(profile, path);
  const normalized = val.status === "invalid" ? raw : val.value ?? raw;

  let validationStatus: MergeCandidate["validationStatus"];
  if (val.status === "invalid") validationStatus = "invalid";
  else if (manualPaths.has(path) && !eq(current, normalized)) validationStatus = "conflict";
  else if (val.status === "review" || needsReview || confidence === "low") validationStatus = "review";
  else validationStatus = "valid";

  const applyByDefault = validationStatus === "valid" && (confidence === "high" || confidence === "medium");

  const reason =
    val.reason ??
    (validationStatus === "conflict"
      ? "You set this manually — protected."
      : validationStatus === "review"
        ? needsReview
          ? "Flagged for review."
          : confidence === "low"
            ? "Low confidence."
            : undefined
        : undefined);

  return { fieldPath: path, label, currentValue: current, extractedValue: normalized, rawEvidence: evidence, confidence, validationStatus, applyByDefault, reason };
}

const ARRAY_LABEL: Record<string, string> = {
  "record.fights": "Fights",
  "media.highlights": "Highlight clips",
  sponsors: "Sponsors",
};

export function buildMergeCandidates(
  profile: FighterProfile,
  extraction: FighterProfileExtractionResult,
  manualPaths: Set<string>,
): MergeCandidate[] {
  const patch = extraction.extractedProfilePatch || {};
  const feByPath = new Map<string, FighterProfileExtractionResult["fieldExtractions"][number]>();
  for (const fe of extraction.fieldExtractions || []) {
    if (fe?.fieldPath) feByPath.set(fe.fieldPath, fe);
  }
  const out: MergeCandidate[] = [];

  // 1) scalar registry fields (patch value wins; fall back to field-extraction value)
  for (const [path, spec] of Object.entries(CANONICAL_PROFILE_FIELDS)) {
    if (path.startsWith("vitals.fightingWeight")) continue; // object handled below
    const patchVal = patchGet(patch, path);
    const fe = feByPath.get(path);
    const raw = patchVal != null && patchVal !== "" ? patchVal : fe?.value;
    if (raw == null || raw === "") continue;
    const confidence = (fe?.confidence ?? "medium") as Confidence;
    const val = validateByType(path, spec.type, raw);
    out.push(makeCandidate(profile, manualPaths, path, spec.label, raw, val, confidence, fe?.rawEvidence ?? "", Boolean(fe?.needsReview)));
  }

  // 2) fighting weight object {value, unit}
  const fw = patchGet(patch, "vitals.fightingWeight") ?? feByPath.get("vitals.fightingWeight")?.value;
  if (fw && typeof fw === "object") {
    const fe = feByPath.get("vitals.fightingWeight");
    const confidence = (fe?.confidence ?? "medium") as Confidence;
    const manualConfirmed = manualPaths.has("vitals.fightingWeight");
    const val = V.validateFightingWeight(fw, { manualConfirmed });
    out.push(makeCandidate(profile, manualPaths, "vitals.fightingWeight", "Fighting weight", fw, val, confidence, fe?.rawEvidence ?? "", Boolean(fe?.needsReview)));
  }

  // 3) arrays — minimum-row rules, never create empty rows
  for (const [path, kind] of Object.entries(ARRAY_FIELDS)) {
    const arr = patchGet(patch, path);
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const { rows, dropped } = V.validateArrayRows(kind, arr);
    if (rows.length === 0) continue;
    const current = getDeep(profile, path);
    if (eq(current, rows)) continue;
    const isConflict = manualPaths.has(path);
    out.push({
      fieldPath: path,
      label: ARRAY_LABEL[path] || path,
      currentValue: current,
      extractedValue: rows,
      rawEvidence: `${rows.length} row(s)`,
      confidence: "medium",
      validationStatus: isConflict ? "conflict" : "valid",
      applyByDefault: !isConflict,
      reason: dropped ? `${dropped} empty / incomplete row(s) dropped.` : undefined,
    });
  }

  // 4) record cross-check: KOs must not exceed wins
  const wins = out.find((c) => c.fieldPath === "record.wins");
  const kos = out.find((c) => c.fieldPath === "record.kos");
  if (wins && kos && typeof wins.extractedValue === "number" && typeof kos.extractedValue === "number" && kos.extractedValue > wins.extractedValue && kos.validationStatus === "valid") {
    kos.validationStatus = "review";
    kos.applyByDefault = false;
    kos.reason = "KOs exceed wins — confirm.";
  }

  // 5) ambiguous record phrase ("ten ten ten ten ten") — never auto-apply.
  if (V.recordPhraseIsAmbiguous(extraction.transcript)) {
    for (const c of out) {
      if (/^record\.(wins|losses|draws|kos)$/.test(c.fieldPath) && c.validationStatus === "valid") {
        c.validationStatus = "review";
        c.applyByDefault = false;
        c.reason = "Ambiguous record — say it as wins, losses, draws, KOs.";
      }
    }
  }

  // 6) do not auto-apply nationality when it merely mirrors residence/birthplace
  //    (inference risk). Confirm explicitly instead.
  const natl = out.find((c) => c.fieldPath === "vitals.nationality");
  if (natl && natl.validationStatus === "valid") {
    const n = String(natl.extractedValue).trim().toLowerCase();
    const res = String(patchGet(patch, "vitals.residence") ?? getDeep(profile, "vitals.residence") ?? "").trim().toLowerCase();
    const birth = String(patchGet(patch, "vitals.birthplace") ?? getDeep(profile, "vitals.birthplace") ?? "").trim().toLowerCase();
    if (n && (n === res || n === birth)) {
      natl.validationStatus = "review";
      natl.applyByDefault = false;
      natl.reason = "Possibly inferred from residence / birthplace — confirm.";
    }
  }

  // Drop no-op candidates (current already equals normalized), keep invalids for display.
  return out.filter((c) => c.validationStatus === "invalid" || !eq(c.currentValue, c.extractedValue));
}

/** Apply the given candidates (never invalid ones) to the profile. */
export function applyCandidates(profile: FighterProfile, candidates: MergeCandidate[]): FighterProfile {
  let next = profile;
  for (const c of candidates) {
    if (c.validationStatus === "invalid") continue;
    next = setDeep(next, c.fieldPath, c.extractedValue);
  }
  return next;
}

export function safeCandidates(candidates: MergeCandidate[]): MergeCandidate[] {
  return candidates.filter((c) => c.applyByDefault);
}
