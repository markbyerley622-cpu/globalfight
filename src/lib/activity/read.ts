import "server-only";
import { prisma } from "@/lib/db";
import type { ActivityType } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  Reading the activity stream.
//
//  CURSOR pagination, not offset. A feed grows at the head, so `skip` drifts:
//  between loading page one and asking for page two, new rows push the window
//  down and the reader sees a row twice — or misses one. A cursor is a fixed
//  point in the stream, so "everything older than this" stays correct however
//  much arrives while they read.
//
//  The composite `(createdAt, id)` cursor matters: two rows written in the same
//  transaction share a timestamp to the millisecond, and a createdAt-only cursor
//  would either skip one or loop on it forever.
// ════════════════════════════════════════════════════════════════════════════

export interface ActivityItem {
  id: string;
  type: ActivityType;
  /** The rendered sentence, resolved at write time. */
  title: string;
  url: string | null;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  /** Opaque; pass back verbatim to get the next page. Null when exhausted. */
  nextCursor: string | null;
}

/** `<iso>_<id>` — opaque to the caller, decoded only here. */
function decodeCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const at = cursor.lastIndexOf("_");
  if (at <= 0) return null;
  const date = new Date(cursor.slice(0, at));
  const id = cursor.slice(at + 1);
  // A malformed or tampered cursor reads as "start from the beginning" rather
  // than throwing: it arrives from a query string and must never 500 a profile.
  if (Number.isNaN(date.getTime()) || !id) return null;
  return { createdAt: date, id };
}

const encodeCursor = (i: { createdAt: Date; id: string }) => `${i.createdAt.toISOString()}_${i.id}`;

/** Hard ceiling — a caller cannot ask for the whole table. */
const MAX_LIMIT = 50;

export async function getActivity(
  userId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<ActivityPage> {
  const limit = Math.min(Math.max(1, opts.limit ?? 15), MAX_LIMIT);
  const after = decodeCursor(opts.cursor);

  const rows = await prisma.activity.findMany({
    where: {
      userId,
      // Strictly older than the cursor. The OR handles the same-millisecond
      // case by falling back to the id, which is why the cursor carries both.
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // One extra to know whether another page exists, without a COUNT over a
    // table that only grows.
    take: limit + 1,
    select: { id: true, type: true, title: true, url: true, createdAt: true },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      url: r.url,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}
