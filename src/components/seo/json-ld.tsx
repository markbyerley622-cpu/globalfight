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

export function JsonLd({ data }: { data: unknown }) {
  const json = escapeJsonLd(JSON.stringify(data));
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
