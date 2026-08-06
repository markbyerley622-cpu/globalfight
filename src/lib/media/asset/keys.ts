import { randomBytes } from "node:crypto";

// ════════════════════════════════════════════════════════════════════════════
//  STORAGE KEYS — three separated namespaces, and never a client-supplied name.
//
//  ── Prefixes, not three literal buckets ─────────────────────────────────
//  The brief asks for temp / quarantine / public buckets. This implements them
//  as three PREFIXES under the configured store, and that difference is worth
//  stating rather than glossing.
//
//  Why prefixes: the existing StorageProvider (lib/storage) is one configured
//  bucket, and every deployment target here (S3, R2, Supabase) expresses
//  access control per prefix perfectly well. Three physical buckets would mean
//  three sets of credentials, three provider configs and a migration, to buy a
//  boundary that a bucket policy already gives.
//
//  What that costs, honestly: the separation is then POLICY rather than
//  physics. A misconfigured bucket that makes everything public would expose
//  quarantine, where three buckets would not. That risk is mitigated in two
//  ways and both matter:
//    1. nothing ever mints a URL for a temp or quarantine key — the functions
//       to do so do not exist, so a leak needs someone to construct the URL by
//       hand from a key they cannot see;
//    2. keys are RANDOM, so knowing the prefix does not let anyone guess one.
//  If the store is ever shared with a third party, promote these to real
//  buckets — the key shape is already namespaced for it.
//
//  ── Never the client's filename ─────────────────────────────────────────
//  An uploaded name is attacker-controlled: it carries traversal ("../../"),
//  null bytes, double extensions ("cat.jpg.php"), and unicode that normalises
//  into all of the above. It is never used, not even sanitised — the name is
//  simply discarded and a random key is minted. There is nothing to sanitise
//  wrongly if you never use the input.
// ════════════════════════════════════════════════════════════════════════════

export type MediaZone = "temp" | "quarantine" | "public";

const PREFIX: Record<MediaZone, string> = {
  temp: "media/temp",
  quarantine: "media/quarantine",
  public: "media/public",
};

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * A fresh, unguessable key.
 *
 * 16 random bytes = 128 bits. Not a counter and not the hash: a sequential key
 * lets someone enumerate the store, and using the CONTENT HASH as the key would
 * mean anyone who has a copy of a file can derive the URL of every other
 * upload of it — which is an information leak dressed up as deduplication.
 * The hash is a database column; the key is random.
 */
export function newMediaKey(zone: MediaZone, mime: string): string {
  const ext = EXT[mime] ?? "bin";
  const id = randomBytes(16).toString("hex");
  // Date-sharded so a lifecycle-policy rule ("delete temp older than N days")
  // can be expressed as a prefix scan rather than a full listing.
  const day = new Date().toISOString().slice(0, 10);
  return `${PREFIX[zone]}/${day}/${id}.${ext}`;
}

/** A variant key derived from a published base. Same random stem, one suffix. */
export function variantKey(publicKey: string, variant: string): string {
  const dot = publicKey.lastIndexOf(".");
  const stem = dot > 0 ? publicKey.slice(0, dot) : publicKey;
  const ext = dot > 0 ? publicKey.slice(dot + 1) : "bin";
  return `${stem}_${variant}.${ext}`;
}

/** Which zone a key belongs to, for assertions and cleanup. */
export function zoneOf(key: string): MediaZone | null {
  for (const [zone, prefix] of Object.entries(PREFIX) as [MediaZone, string][]) {
    if (key.startsWith(`${prefix}/`)) return zone;
  }
  return null;
}

/**
 * The one guard that turns the policy boundary into a code boundary.
 *
 * Every function that mints a public URL calls this first. A temp or quarantine
 * key reaching a URL builder is a programming error and must throw loudly
 * rather than quietly returning a link to unscanned or infected bytes.
 */
export function assertPublicKey(key: string): void {
  if (zoneOf(key) !== "public") {
    throw new Error("Refusing to expose a non-public media key.");
  }
}
