import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getFeed, type FeedSort, type FeedWindow } from "@/lib/forum/repo";

const SORTS: FeedSort[] = ["latest", "trending", "following", "most-discussed", "newest", "most-liked"];
const WINDOWS: FeedWindow[] = ["today", "week", "month", "all"];

/**
 * Community feed. Query params:
 *   sort     latest | trending | following | most-discussed | newest | most-liked
 *   window   today | week | month | all   (trending only)
 *   category category slug to scope the feed
 *   cursor   keyset cursor (not used for trending — ranked single page)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sortParam = searchParams.get("sort") as FeedSort | null;
  const windowParam = searchParams.get("window") as FeedWindow | null;
  const sort = sortParam && SORTS.includes(sortParam) ? sortParam : "latest";
  const window = windowParam && WINDOWS.includes(windowParam) ? windowParam : "week";
  const categorySlug = searchParams.get("category") ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Number(searchParams.get("limit")) || undefined;
  const viewerId = (await getSessionUserId()) ?? undefined;

  const page = await getFeed({ sort, window, categorySlug, cursor, limit, viewerId });
  return NextResponse.json(page);
}

export const dynamic = "force-dynamic";
