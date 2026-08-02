import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isCanonicalHost, resolveSiteUrl } from "@/lib/config";

// The audit found canonical URLs, OG images, the robots Host and the sitemap all
// pointing at globalfight.onrender.com, which returns 503 — every ranking signal
// aimed at a dead host. The fallback chain was doing its job; the problem is that
// a Render service slug is not a product address, and nothing could tell the
// difference. "An operator stated the origin" is that difference.

const saved = {
  site: process.env.NEXT_PUBLIC_SITE_URL,
  render: process.env.RENDER_EXTERNAL_URL,
};

afterEach(() => {
  for (const [k, v] of [["NEXT_PUBLIC_SITE_URL", saved.site], ["RENDER_EXTERNAL_URL", saved.render]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("an explicitly named origin is canonical", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://combatreviews.com";
  assert.equal(isCanonicalHost(), true);
});

test("a Render slug alone is NOT canonical — it must not be indexed", () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  process.env.RENDER_EXTERNAL_URL = "https://globalfight.onrender.com";
  assert.equal(isCanonicalHost(), false);
  // The fallback still resolves, so links and password-reset emails keep working.
  assert.equal(resolveSiteUrl(), "https://globalfight.onrender.com");
});

test("nothing configured is not canonical", () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.RENDER_EXTERNAL_URL;
  assert.equal(isCanonicalHost(), false);
});

test("an unparseable override is not a claim of canonicity", () => {
  // The copy-pasted-placeholder case that once cost a deploy. It degrades to the
  // next source for SITE.url, and must not mark the deployment as the real one.
  process.env.NEXT_PUBLIC_SITE_URL = "https://<your-app>.onrender.com";
  assert.equal(isCanonicalHost(), false);
});
