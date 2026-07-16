// Parse feed query options from a request URL. Shared by the feed route handlers.
import type { SelectOptions } from "./types";

export function optsFromRequest(req: Request): SelectOptions & { cid: string } {
  const q = new URL(req.url).searchParams;
  return {
    cid: q.get("cid") || "anon",
    topics: q.get("topics")?.split(",").filter(Boolean) ?? [],
    hide: q.get("hide")?.split(",").filter(Boolean) ?? [],
    minSeconds: Number(q.get("minSeconds")) || 0,
    q: q.get("q") || "",
    intent: q.get("intent") || "",
    sort: (q.get("sort") as SelectOptions["sort"]) || "smart",
    limit: q.get("limit") ? Number(q.get("limit")) : undefined,
    offset: q.get("offset") ? Number(q.get("offset")) : undefined,
    opener: q.get("opener") === "1",
    excludeOpeners: q.get("excludeOpeners")?.split(",").filter(Boolean) ?? [],
  };
}
