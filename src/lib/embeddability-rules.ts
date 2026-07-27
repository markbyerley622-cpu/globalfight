// ════════════════════════════════════════════════════════════════════════════
//  Framing rules — PURE. No fetch, no cache, no `server-only`.
//
//  Split from lib/embeddability for the same reason the scoring math is split from
//  the reputation engine: this is the part with all the decisions in it and none of
//  the IO, so it can be unit-tested against real header strings without a network
//  or a database. The server-only half does the request and the caching.
// ════════════════════════════════════════════════════════════════════════════

export type Embeddable = { embeddable: boolean; reason: string };

/**
 * Reject anything that is not a public http(s) URL.
 *
 * The caller FETCHES this URL server-side, and it originates in ingested data, so
 * this is an SSRF surface: without the guard a crafted `sourceUrl` could make the
 * server request localhost, a link-local address, or the cloud metadata endpoint
 * (169.254.169.254) and report back whether it framed.
 */
export function safeArticleUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    // 172.16.0.0 – 172.31.255.255 only. 172.32.x is public, and a looser pattern
    // would refuse real publishers.
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return null;
  }
  return u;
}

/**
 * Decide framing from response headers.
 *
 * The polarity here is the whole point and is easy to invert: an ABSENT
 * frame-ancestors directive means "no restriction", while `frame-ancestors 'none'`
 * means the opposite. Guessing permissive shows the reader a blank white iframe,
 * so every ambiguous case resolves to NOT embeddable.
 */
export function readFramingHeaders(headers: { get(name: string): string | null }): Embeddable {
  const xfo = headers.get("x-frame-options")?.trim().toLowerCase() ?? "";
  // DENY blocks everyone. SAMEORIGIN blocks us specifically — we are never the
  // same origin as a publisher — so it is equally fatal. ALLOW-FROM is obsolete and
  // ignored by browsers, but a site sending it is expressing intent to restrict.
  if (xfo.startsWith("deny")) return { embeddable: false, reason: "x-frame-options: deny" };
  if (xfo.startsWith("sameorigin")) return { embeddable: false, reason: "x-frame-options: sameorigin" };
  if (xfo.startsWith("allow-from")) return { embeddable: false, reason: "x-frame-options: allow-from" };

  const csp = headers.get("content-security-policy") ?? "";
  if (csp) {
    // Matched as a whole directive name, so `frame-src` — which governs what the
    // page may frame, not who may frame IT — cannot be mistaken for this one.
    const directive = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => /^frame-ancestors(\s|$)/i.test(d));

    if (directive) {
      const value = directive.replace(/^frame-ancestors/i, "").trim().toLowerCase();
      if (!value || value.includes("'none'")) {
        return { embeddable: false, reason: "csp frame-ancestors: none" };
      }
      const sources = value.split(/\s+/).filter(Boolean);
      if (sources.every((s) => s === "'self'")) {
        return { embeddable: false, reason: "csp frame-ancestors: self" };
      }
      // Anything narrower than a wildcard is an allow-list we cannot confirm we are
      // on, and being wrong permissively costs a blank frame.
      if (!sources.includes("*") && !sources.includes("https:")) {
        return { embeddable: false, reason: "csp frame-ancestors: restricted list" };
      }
    }
  }

  return { embeddable: true, reason: "no framing restriction" };
}
