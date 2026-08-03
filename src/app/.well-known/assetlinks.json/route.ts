import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════
//  Digital Asset Links — the file that makes a Trusted Web Activity work.
//
//  Android fetches https://<origin>/.well-known/assetlinks.json when the TWA
//  launches and checks that this site vouches for the app's signing key. If it
//  does not match, the app still opens — but inside a Chrome Custom Tab WITH A
//  URL BAR. That is the single most common "why does my TWA look like a
//  browser?" failure, and it is silent: nothing errors, the app just stops
//  looking like an app.
//
//  A ROUTE, NOT A STATIC FILE, on purpose. The SHA-256 fingerprint belongs to a
//  signing key, and which key is correct depends on the deployment: Play App
//  Signing re-signs your upload with Google's own key, so the fingerprint that
//  works in production is NOT the one from your local keystore. Committing a
//  static file bakes in one answer and guarantees it is wrong in at least one
//  environment. Reading it from the environment lets staging and production hold
//  different keys, and lets you paste the Play Console value without a redeploy
//  of committed content.
//
//  SET THESE BEFORE SUBMITTING TO GOOGLE PLAY:
//
//    TWA_PACKAGE_NAME        e.g. com.combatreviews.app
//    TWA_SHA256_FINGERPRINTS the SHA-256 cert fingerprints, colon-separated hex.
//                            Comma-separate MULTIPLE keys — you almost always
//                            need two: your upload key AND the Play App Signing
//                            key (Play Console → Setup → App integrity).
//                            Listing both is what makes internal-testing builds
//                            and production builds both verify.
//
//  Returns 404 while unset rather than an empty or placeholder statement list.
//  A malformed assetlinks.json is worse than a missing one: Android caches the
//  failure, so a bad file can keep the URL bar visible after you fix it.
// ════════════════════════════════════════════════════════════════════════

export function GET() {
  const pkg = process.env.TWA_PACKAGE_NAME?.trim();
  const raw = process.env.TWA_SHA256_FINGERPRINTS?.trim();

  if (!pkg || !raw) {
    return NextResponse.json(
      {
        error: "Digital Asset Links are not configured",
        detail:
          "Set TWA_PACKAGE_NAME and TWA_SHA256_FINGERPRINTS to publish this statement. " +
          "Include BOTH your upload key and the Play App Signing key, comma-separated.",
      },
      { status: 404 },
    );
  }

  const fingerprints = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: pkg,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    {
      headers: {
        "content-type": "application/json",
        // Android re-checks this periodically. An hour is short enough that
        // rotating a key takes effect the same day, long enough not to be hit
        // on every launch.
        "cache-control": "public, max-age=3600",
      },
    },
  );
}
