// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — JSON-LD extraction (layer 1 of the parse strategy).
//
//  BKFC (a Webflow site) emits schema.org JSON-LD for Event, Person and
//  SportsOrganization. We prefer it over the DOM wherever it carries the field,
//  and fall back to cheerio for the rest. This module only parses & narrows the
//  blocks; the entity extractors decide what to trust.
// ════════════════════════════════════════════════════════════════════════

import type { CheerioAPI } from "cheerio";

/** Parse every `application/ld+json` block into plain objects (bad blocks skipped). */
export function extractJsonLd($: CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      // A block may be a single object or an array (or an @graph wrapper).
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const graph = obj["@graph"];
          if (Array.isArray(graph)) {
            for (const g of graph) if (g && typeof g === "object") out.push(g as Record<string, unknown>);
          } else {
            out.push(obj);
          }
        }
      }
    } catch {
      // A single malformed block must not sink the whole parse.
    }
  });
  return out;
}

/** True when a JSON-LD node is of the given schema.org @type. */
export function isType(node: Record<string, unknown>, type: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t.toLowerCase() === type.toLowerCase();
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && x.toLowerCase() === type.toLowerCase());
  return false;
}

/** First JSON-LD node matching `type`, or null. */
export function findType(nodes: Record<string, unknown>[], type: string): Record<string, unknown> | null {
  return nodes.find((n) => isType(n, type)) ?? null;
}

/** Safely read a string property, following one level of nesting via `path`. */
export function str(node: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!node) return null;
  const v = node[key];
  return typeof v === "string" && v.trim().length ? v.trim() : null;
}

/** Read a nested object property (e.g. Event.location). */
export function obj(
  node: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!node) return null;
  const v = node[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Read a property that may be a string or an array of strings, as an array. */
export function strArray(node: Record<string, unknown> | null | undefined, key: string): string[] {
  if (!node) return [];
  const v = node[key];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return [];
}
