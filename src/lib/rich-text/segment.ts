import { RICH_TEXT_TOKEN } from "@/lib/mentions";
import { sanitizeEntities, type RichEntity } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  Segmentation — text + entities → a flat list of things to render.
//
//  ── Why the renderer does not do this itself ──────────────────────────────
//  There are two sources of truth for what a span means (structured entities
//  for new content, a regex for legacy content) and exactly one place is
//  allowed to reconcile them. A renderer that branched on "do I have entities?"
//  would grow a second copy of the legacy path the first time somebody wrote a
//  hover card, and the two would disagree about where a mention ends.
//
//  So this is pure, testable, and returns segments a renderer maps 1:1 to
//  elements without making a single decision of its own.
//
//  PURE: no React, no prisma.
// ════════════════════════════════════════════════════════════════════════════

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | {
      kind: "entity";
      text: string;
      entity: RichEntity;
      /** True when this came from the LEGACY regex, not from stored entities. */
      legacy: boolean;
    };

/**
 * Split a single line into segments.
 *
 * ── The precedence, and why ───────────────────────────────────────────────
 * STRUCTURED entities win outright. When a body carries them they are the
 * complete account of what is a mention in it — the regex is not consulted at
 * all, not even for spans the entities missed. Running both would mean a body
 * where somebody typed a literal "@someone" without picking them gets a
 * highlighted, unlinked, un-notified mention beside a real one, which is
 * exactly the "styled but inert" failure the old system had.
 *
 * The regex path is reached only when there are NO entities: legacy content,
 * and content written by a client that did not send them.
 */
export function segmentLine(
  line: string,
  entities: RichEntity[],
  /** Offset of this line within the whole body — entity offsets are absolute. */
  lineStart: number,
): Segment[] {
  const inLine = entities.filter((e) => e.start >= lineStart && e.end <= lineStart + line.length);

  if (inLine.length === 0) return legacySegments(line);

  const out: Segment[] = [];
  let cursor = 0;
  for (const e of inLine) {
    const from = e.start - lineStart;
    const to = e.end - lineStart;
    if (from > cursor) out.push(...legacySegmentsTextOnly(line.slice(cursor, from)));
    out.push({ kind: "entity", text: line.slice(from, to), entity: e, legacy: false });
    cursor = to;
  }
  if (cursor < line.length) out.push(...legacySegmentsTextOnly(line.slice(cursor)));
  return out;
}

/**
 * Legacy path: the original regex, producing the same output shape.
 *
 * A mention found this way has NO id — the entity carries the handle in its
 * hint and an empty id, which is what `legacy: true` warns the renderer about.
 * It can still link (by handle) but it cannot survive a rename, which is the
 * entire point of the structured layer.
 */
function legacySegments(line: string): Segment[] {
  const out: Segment[] = [];
  for (const part of line.split(RICH_TEXT_TOKEN)) {
    if (!part) continue;
    if (part.startsWith("@")) {
      out.push({
        kind: "entity",
        text: part,
        entity: { type: "mention", id: "", start: 0, end: 0, hint: { username: part.slice(1) } },
        legacy: true,
      });
    } else if (/^https?:\/\//.test(part)) {
      out.push({ kind: "link", text: part, href: part });
    } else {
      out.push({ kind: "text", text: part });
    }
  }
  return out;
}

/**
 * The gaps BETWEEN structured entities.
 *
 * Links are still detected here — a URL is not something anybody picks from a
 * menu, so it has no structured form yet and the regex remains its only source.
 * Stray "@names" in these gaps are deliberately left as plain text: see the
 * precedence note above.
 */
function legacySegmentsTextOnly(chunk: string): Segment[] {
  const out: Segment[] = [];
  for (const part of chunk.split(RICH_TEXT_TOKEN)) {
    if (!part) continue;
    if (/^https?:\/\//.test(part)) out.push({ kind: "link", text: part, href: part });
    else out.push({ kind: "text", text: part });
  }
  return out;
}

/** Segment a whole body, preserving line breaks. */
export function segmentBody(text: string, rawEntities: unknown): Segment[][] {
  const entities = sanitizeEntities(rawEntities, text);
  const lines = text.split("\n");
  const out: Segment[][] = [];
  let offset = 0;
  for (const line of lines) {
    out.push(segmentLine(line, entities, offset));
    offset += line.length + 1; // +1 for the "\n" that split() removed
  }
  return out;
}
