import { headers } from "next/headers";

// Safe JSON-LD injector. `JSON.stringify` does NOT escape `<`, `>`, `&` or the
// U+2028/U+2029 line separators, so a value containing `</script>` (or a lone
// separator that breaks a JS string) can break out of the <script> block and
// inject markup. Any field here can be user-controlled (a fighter's chosen name,
// an article author), so we escape those sequences to their uXXXX forms — which
// are still valid JSON and parse identically — before writing them into the DOM.
//
// Use this for every `application/ld+json` block; never hand-write the <script>.

// Matches &, <, >, U+2028, U+2029 — written as \u escapes so there are no
// invisible characters in this source file.
const UNSAFE = /[\u0026\u003c\u003e\u2028\u2029]/g;
const BACKSLASH = String.fromCharCode(92); // avoids a backslash string literal

function escapeJsonLd(json: string): string {
  return json.replace(UNSAFE, (c) => BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/**
 * NONCED, because the CSP is now enforced.
 *
 * `script-src` no longer carries 'unsafe-inline' (see src/middleware.ts), and
 * this is an inline <script> element. Browsers disagree about whether a
 * non-executable DATA BLOCK like `application/ld+json` is subject to script-src
 * at all — the spec's "should element be blocked a priori" step is written
 * against script elements generally, while several engines exempt data blocks
 * in practice.
 *
 * That disagreement is not something to leave to chance on the two pages that
 * carry structured data, and the failure would be silent: no error a user sees,
 * just Google quietly losing the fighter and article markup. Carrying the nonce
 * costs one header read and is correct under either interpretation.
 *
 * `headers()` is why this is async — the middleware puts the per-request nonce
 * on `x-nonce`. If it is ever absent (a route the matcher skips), the attribute
 * is simply omitted rather than rendered as the string "undefined".
 */
export async function JsonLd({ data }: { data: unknown }) {
  const json = escapeJsonLd(JSON.stringify(data));
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: json }} />;
}
