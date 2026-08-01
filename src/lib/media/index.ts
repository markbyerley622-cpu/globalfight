// ════════════════════════════════════════════════════════════════════════
//  Media ingestion — provider-shaped image pipeline.
//
//  Bytes are downloaded ONCE, processed by the existing image store
//  (sharp variants -> getStorage()), and never hotlinked: the source URL is kept
//  as provenance only. Refreshes are conditional (ETag / Last-Modified) and a
//  lower-quality source can never overwrite a better one.
//
//  Entry points: `npm run images:sync`, `npm run images:coverage`.
// ════════════════════════════════════════════════════════════════════════

export { TIERS, tierRank, mayReplace, emptyReport } from "./types";
export type {
  MediaTier, MediaCandidate, MediaProvider, MediaSubject, MediaOutcome, MediaReport, HeldMedia,
} from "./types";
export { fetchImageConditional, sha256, type HttpFetch, type ImageFetchResult } from "./fetch";
export { MEDIA_PROVIDERS, providerFor, espnHeadshots } from "./providers";
export { syncMedia, isDueForRetry, MISS_RETRY_DAYS, type MediaSyncOpts, type MediaWrite } from "./sync";
