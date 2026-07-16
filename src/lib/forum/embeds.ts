// ════════════════════════════════════════════════════════════════════════
//  Forum media model + social-embed parsing.
//
//  A post carries a list of `ForumAttachment`s. Two kinds exist:
//   • uploaded media ("image" / "video") — stored through our image pipeline.
//   • social embeds ("youtube" / "instagram" / "x" / "tiktok") — a pasted URL
//     parsed into a canonical descriptor here so both the server (validation)
//     and the client (rendering) agree on the shape.
//
//  Client + server safe: NO server-only imports.
// ════════════════════════════════════════════════════════════════════════

export type ForumAttachment =
  | { type: "image"; url: string; thumbUrl?: string; width?: number; height?: number; caption?: string }
  | { type: "video"; url: string; thumbUrl?: string; caption?: string }
  | { type: "youtube"; url: string; videoId: string; thumbUrl: string }
  | { type: "instagram"; url: string }
  | { type: "x"; url: string }
  | { type: "tiktok"; url: string; videoId?: string };

export type EmbedKind = ForumAttachment["type"];

const YT_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"];

/** Extract a YouTube video id from any common URL form. */
function youtubeId(u: URL): string | null {
  if (u.hostname.endsWith("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
  if (u.pathname.startsWith("/watch")) return u.searchParams.get("v");
  const m = u.pathname.match(/\/(embed|shorts|v|live)\/([\w-]{6,})/);
  return m ? m[2] : null;
}

/** Pull the numeric video id out of a TikTok `/video/<id>` URL when present. */
function tiktokId(u: URL): string | undefined {
  const m = u.pathname.match(/\/video\/(\d+)/);
  return m ? m[1] : undefined;
}

/**
 * Parse a pasted URL into a social embed descriptor, or null if it isn't a
 * platform we embed. Never throws — invalid input returns null.
 */
export function parseEmbed(raw: string): ForumAttachment | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");

  if (YT_HOSTS.includes(u.hostname)) {
    const id = youtubeId(u);
    if (id) {
      return {
        type: "youtube",
        url: `https://www.youtube.com/watch?v=${id}`,
        videoId: id,
        thumbUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
    }
  }

  if (host === "instagram.com" || host === "instagr.am") {
    if (/\/(p|reel|tv)\//.test(u.pathname)) {
      // Canonicalise to the bare post URL (strip tracking query/hash).
      return { type: "instagram", url: `https://www.instagram.com${u.pathname.replace(/\/$/, "")}/` };
    }
  }

  if (host === "twitter.com" || host === "x.com") {
    if (/\/status\/\d+/.test(u.pathname)) {
      return { type: "x", url: `https://twitter.com${u.pathname}` };
    }
  }

  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return { type: "tiktok", url: trimmed, videoId: tiktokId(u) };
  }

  return null;
}

/** True when a URL is an embeddable social link (used to gate the embed UI). */
export function isEmbeddableUrl(raw: string): boolean {
  return parseEmbed(raw) !== null;
}

const MAX_ATTACHMENTS = 8;

/**
 * Validate/normalise an attachments array coming off an API request body.
 * Drops anything malformed and caps the count so a post can't carry an
 * unbounded payload. Returns a clean array (possibly empty).
 */
export function sanitizeAttachments(input: unknown): ForumAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ForumAttachment[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const type = a.type;
    const url = typeof a.url === "string" ? a.url.trim() : "";
    if (!url || !/^https?:\/\//i.test(url) && !url.startsWith("/")) continue;

    if (type === "image") {
      out.push({
        type: "image",
        url,
        thumbUrl: typeof a.thumbUrl === "string" ? a.thumbUrl : undefined,
        width: typeof a.width === "number" ? a.width : undefined,
        height: typeof a.height === "number" ? a.height : undefined,
        caption: typeof a.caption === "string" ? a.caption.slice(0, 280) : undefined,
      });
    } else if (type === "video") {
      out.push({ type: "video", url, thumbUrl: typeof a.thumbUrl === "string" ? a.thumbUrl : undefined });
    } else if (type === "youtube" || type === "instagram" || type === "x" || type === "tiktok") {
      // Re-parse social embeds server-side from their URL so a client can't
      // forge a descriptor (e.g. point a "youtube" embed at a phishing host).
      const parsed = parseEmbed(url);
      if (parsed && parsed.type === type) out.push(parsed);
    }
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}
