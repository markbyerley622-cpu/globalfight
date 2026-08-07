import "server-only";
import { prisma } from "@/lib/db";
import { publicDisplayName } from "@/lib/display-name";
import { sanitizeEntities, MAX_ENTITIES, type RichEntity } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  Rich-text entities — the server half.
//
//  Two jobs, deliberately separate:
//
//    RESOLVE (write path) — turn the client's draft spans, which carry a
//      HANDLE, into stored entities that carry a USER ID. This is the moment
//      identity is fixed, and it is the only moment a username is ever used to
//      decide who somebody meant.
//
//    HYDRATE (read path)  — refresh the display hints from the database. This
//      is why a rename no longer orphans anything: the stored row keeps
//      pointing at the same id, and the handle rendered today is today's.
//
//  Note the asymmetry, which is the whole architecture in one line: usernames
//  flow IN once, ids are what is stored, and usernames flow back OUT fresh.
// ════════════════════════════════════════════════════════════════════════════

/** What the client sends — a span plus the handle that was picked. */
export interface DraftEntity {
  type: "mention";
  username: string;
  start: number;
  end: number;
}

const isIndex = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Turn draft spans into verified, stored entities.
 *
 * ── Why the text is re-checked against the span ───────────────────────────
 * A draft says "characters 8..13 are @alex". The server does not take that on
 * trust: it slices the text and requires it to actually read `@alex`. Without
 * that check a client could attach any user's id to any span — including a span
 * over somebody else's words — and the mention would render, link and notify.
 *
 * ONE query regardless of how many mentions the body carries.
 */
export async function resolveDraftEntities(
  text: string,
  raw: unknown,
): Promise<RichEntity[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Shape-check first, cheaply, before touching the database.
  const drafts: DraftEntity[] = [];
  for (const item of raw.slice(0, MAX_ENTITIES * 2)) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (d.type !== "mention") continue;
    if (typeof d.username !== "string" || !/^[a-zA-Z0-9_]{2,30}$/.test(d.username)) continue;
    if (!isIndex(d.start) || !isIndex(d.end) || d.start >= d.end || d.end > text.length) continue;
    // The span must BE the handle it claims to be.
    if (text.slice(d.start, d.end).toLowerCase() !== `@${d.username}`.toLowerCase()) continue;
    drafts.push({ type: "mention", username: d.username, start: d.start, end: d.end });
  }
  if (drafts.length === 0) return [];

  const handles = [...new Set(drafts.map((d) => d.username.toLowerCase()))];
  const users = await prisma.user.findMany({
    where: { username: { in: handles, mode: "insensitive" } },
    select: { id: true, username: true, name: true },
  });
  const byHandle = new Map(users.map((u) => [(u.username ?? "").toLowerCase(), u]));

  const entities: RichEntity[] = drafts.flatMap((d) => {
    const u = byHandle.get(d.username.toLowerCase());
    // A handle that resolves to nobody is dropped and the span stays plain
    // text. Storing it would be a permanent link to an account that does not
    // exist.
    if (!u?.username) return [];
    return [{
      type: "mention" as const,
      id: u.id,
      start: d.start,
      end: d.end,
      // Stamped from the DATABASE, never from the request — otherwise a client
      // could write "@admin" as the display value over somebody else's id.
      hint: { username: u.username, name: publicDisplayName(u) },
    }];
  });

  // Run the same sanitiser the read path uses, so anything stored is already
  // known-good by the rules the renderer will apply to it.
  return sanitizeEntities(entities, text);
}

/**
 * Refresh stored entities against the CURRENT state of the rows they name.
 *
 * ── Why on read rather than as a migration ────────────────────────────────
 * A rename would otherwise have to rewrite every historical row that mentioned
 * that person — unbounded write amplification on a routine profile edit, and
 * one that silently misses anything written later. A batched lookup on read
 * costs one query per page and is always correct.
 *
 * A deleted user keeps their SPAN but loses the handle, so the renderer shows
 * the original words without a link rather than deleting them from a sentence
 * that was written around them.
 */
export async function hydrateEntities(
  rows: { text: string; entities: unknown }[],
): Promise<RichEntity[][]> {
  const per = rows.map((r) => sanitizeEntities(r.entities, r.text));

  const ids = [...new Set(per.flat().filter((e) => e.type === "mention").map((e) => e.id))];
  if (ids.length === 0) return per;

  // ONE query for a whole page of content — not one per body, and certainly
  // not one per mention.
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, username: true, name: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return per.map((entities) =>
    entities.map((e) => {
      if (e.type !== "mention") return e;
      const u = byId.get(e.id);
      return u?.username
        ? { ...e, hint: { username: u.username, name: publicDisplayName(u) } }
        // Gone. Keep the span, drop the handle — the renderer reads an absent
        // username as "render the text, do not link it".
        : { ...e, hint: { username: undefined, name: e.hint?.name } };
    }),
  );
}

/** Convenience for a single body. */
export async function hydrateOne(text: string, entities: unknown): Promise<RichEntity[]> {
  const [out] = await hydrateEntities([{ text, entities }]);
  return out;
}
