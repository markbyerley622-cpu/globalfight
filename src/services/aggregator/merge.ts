// Field-level merge that never overwrites a higher-confidence value with a
// lower-confidence one. Records every conflict for observability.

import type { SourceMeta } from "../providers/types";

export interface FieldConflict {
  field: string;
  kept: { source: string; value: unknown; confidence: number };
  dropped: { source: string; value: unknown; confidence: number };
}

export interface MergeResult<T> {
  value: T;
  // Per-field winning source confidence, for persisting provenance.
  fieldConfidence: Record<string, number>;
  conflicts: FieldConflict[];
}

/**
 * Merge `incoming` onto `base`. For each defined field in `incoming`, it wins
 * only if its confidence strictly exceeds the confidence already recorded for
 * that field (defaults to 0 for fields base never set). Equal confidence keeps
 * the existing value (first-writer-wins, stable).
 */
export function mergeRecord<T extends Record<string, unknown>>(
  base: T,
  baseConfidence: Record<string, number>,
  incoming: Partial<T>,
  meta: SourceMeta,
): MergeResult<T> {
  const value = { ...base };
  const fieldConfidence = { ...baseConfidence };
  const conflicts: FieldConflict[] = [];

  for (const [field, incomingValue] of Object.entries(incoming)) {
    if (incomingValue === undefined || incomingValue === null) continue;
    const existingConf = fieldConfidence[field] ?? 0;
    const existingValue = (value as Record<string, unknown>)[field];

    if (existingValue === undefined || existingValue === null || meta.confidence > existingConf) {
      if (
        existingValue !== undefined && existingValue !== null &&
        existingValue !== incomingValue
      ) {
        conflicts.push({
          field,
          kept: { source: meta.source, value: incomingValue, confidence: meta.confidence },
          dropped: { source: "previous", value: existingValue, confidence: existingConf },
        });
      }
      (value as Record<string, unknown>)[field] = incomingValue;
      fieldConfidence[field] = meta.confidence;
    } else if (existingValue !== incomingValue) {
      conflicts.push({
        field,
        kept: { source: "previous", value: existingValue, confidence: existingConf },
        dropped: { source: meta.source, value: incomingValue, confidence: meta.confidence },
      });
    }
  }

  return { value, fieldConfidence, conflicts };
}
