// ════════════════════════════════════════════════════════════════════════
//  Media storage abstraction. The app never references a filesystem path or a
//  specific bucket directly — it goes through this interface, so the provider
//  swaps via env with zero call-site changes.
//
//    STORAGE_PROVIDER = url | supabase | s3 | r2   (default: url)
//
//  • "url"      — owner pastes an already-hosted image/video URL (works today).
//  • supabase/s3/r2 — implement createUploadUrl() with the SDK + creds; the
//    upload UI POSTs the file to the returned presigned URL and stores the
//    returned public URL. Interface below is the contract to implement.
// ════════════════════════════════════════════════════════════════════════

export interface PresignedUpload {
  uploadUrl: string;   // PUT the file here
  publicUrl: string;   // store this on the record
  headers?: Record<string, string>;
}

export interface StorageProvider {
  readonly name: string;
  /** Validate/normalise a public URL for storage on a record. */
  normalize(url: string): string;
  /** Create a presigned upload target. Throws until a cloud provider is configured. */
  createUploadUrl(key: string, contentType: string): Promise<PresignedUpload>;
}

function normalizeHttpUrl(url: string): string {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) throw new Error("Enter a valid image URL (https://…).");
  return u;
}

const urlProvider: StorageProvider = {
  name: "url",
  normalize: normalizeHttpUrl,
  async createUploadUrl() {
    throw new Error(
      "Binary uploads need a cloud provider. Set STORAGE_PROVIDER=supabase|s3|r2 with credentials, " +
      "or paste a hosted image URL.",
    );
  },
};

// Supabase Storage. Returns a signed upload URL the browser PUTs to, plus the
// resulting public URL. Lazy-imports the SDK so it's only required when used.
const supabaseProvider: StorageProvider = {
  name: "supabase",
  normalize: normalizeHttpUrl,
  async createUploadUrl(key, _contentType) {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_BUCKET ?? "media";
    if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    const mod = "@supabase/supabase-js";
    const sb = (await import(/* webpackIgnore: true */ mod).catch(() => null)) as
      | { createClient: (u: string, k: string) => { storage: { from: (b: string) => {
          createSignedUploadUrl: (k: string) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
          getPublicUrl: (k: string) => { data: { publicUrl: string } };
        } } } }
      | null;
    if (!sb) throw new Error("Run `npm i @supabase/supabase-js` to use Supabase Storage.");
    const client = sb.createClient(url, serviceKey);
    const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(key);
    if (error || !data) throw new Error("Could not create a Supabase upload URL.");
    const publicUrl = client.storage.from(bucket).getPublicUrl(key).data.publicUrl;
    return { uploadUrl: data.signedUrl, publicUrl };
  },
};

// AWS S3 / Cloudflare R2 (S3-compatible). Presigns a PUT and returns the public
// URL. Lazy-imports the AWS SDK + presigner.
const s3Provider: StorageProvider = {
  name: "s3",
  normalize: normalizeHttpUrl,
  async createUploadUrl(key, contentType) {
    const endpoint = process.env.R2_ENDPOINT ?? process.env.S3_ENDPOINT;
    const bucket = process.env.R2_BUCKET ?? process.env.S3_BUCKET;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
    const publicBase = process.env.R2_PUBLIC_BASE_URL ?? process.env.S3_PUBLIC_BASE_URL;
    if (!bucket || !accessKeyId || !secretAccessKey || !publicBase) {
      throw new Error("Set R2_/S3_ BUCKET, ACCESS_KEY_ID, SECRET_ACCESS_KEY and PUBLIC_BASE_URL.");
    }
    // Indirect the module names so TS/webpack don't statically resolve optional,
    // not-yet-installed deps (mirrors the @vercel/blob pattern in images/store).
    const clientMod = "@aws-sdk/client-s3";
    const presignMod = "@aws-sdk/s3-request-presigner";
    const [client, presigner] = await Promise.all([
      import(/* webpackIgnore: true */ clientMod).catch(() => null),
      import(/* webpackIgnore: true */ presignMod).catch(() => null),
    ]) as [
      | { S3Client: new (c: unknown) => unknown; PutObjectCommand: new (c: unknown) => unknown }
      | null,
      { getSignedUrl: (c: unknown, cmd: unknown, o: unknown) => Promise<string> } | null,
    ];
    if (!client || !presigner) throw new Error("Run `npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`.");
    const s3 = new client.S3Client({
      region: process.env.R2_REGION ?? process.env.S3_REGION ?? "auto",
      endpoint: endpoint || undefined,
      credentials: { accessKeyId, secretAccessKey },
    });
    const cmd = new client.PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
    const uploadUrl = await presigner.getSignedUrl(s3, cmd, { expiresIn: 600 });
    return { uploadUrl, publicUrl: `${publicBase.replace(/\/$/, "")}/${key}`, headers: { "content-type": contentType } };
  },
};

export function getStorage(): StorageProvider {
  switch (process.env.STORAGE_PROVIDER ?? "url") {
    case "supabase": return supabaseProvider;
    case "s3":
    case "r2": return s3Provider;
    default: return urlProvider;
  }
}
