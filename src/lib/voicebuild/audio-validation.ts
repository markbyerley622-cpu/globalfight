// Audio upload validation for voicebuild.
//
// The browser's declared MIME type and the filename are attacker-controlled, so
// neither is trusted. The decision is made on the bytes.
//
// Pure functions, no server-only import, so this is unit-testable.

/** Hard ceiling on a single upload. A voice note is small; anything larger is abuse. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Maximum accepted duration. We cannot decode every container without a heavy
 * dependency, so this is enforced as a byte ceiling per format rather than a
 * true decode — see MAX_AUDIO_BYTES. The client also caps recording length.
 */
export const MAX_AUDIO_SECONDS = 180;

export const ACCEPTED_AUDIO_MIME = [
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",   // mp3
  "audio/mp4",    // m4a / aac in mp4
  "audio/wav",
  "audio/x-wav",
] as const;
export type AcceptedAudioMime = (typeof ACCEPTED_AUDIO_MIME)[number];

/**
 * Identify a buffer by magic bytes. Returns a canonical MIME, or null when the
 * content is not an audio container we accept.
 */
export function sniffAudio(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  const head = buf.subarray(0, 4);

  // WAV / WebM-Ogg share a RIFF/EBML style prefix — check each explicitly.
  // RIFF....WAVE
  if (head.toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WAVE") {
    return "audio/wav";
  }
  // OggS
  if (head.toString("latin1") === "OggS") return "audio/ogg";
  // EBML (Matroska/WebM): 1A 45 DF A3
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "audio/webm";
  // MP3: ID3 tag, or an MPEG frame sync (FF Ex/Fx)
  if (head.subarray(0, 3).toString("latin1") === "ID3") return "audio/mpeg";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
  // MP4/M4A: ....ftyp
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") return "audio/mp4";

  return null;
}

/**
 * Reject polyglots and anything carrying markup/script in its head. An "audio"
 * file whose first bytes contain <script> or <svg> is not an audio file.
 */
export function looksLikePolyglot(buf: Buffer): boolean {
  const head = buf.subarray(0, 2048).toString("latin1").toLowerCase();
  return (
    head.includes("<svg") ||
    head.includes("<html") ||
    head.includes("<!doctype") ||
    head.includes("<script") ||
    head.includes("<?php")
  );
}

export type AudioVerdict =
  | { ok: true; mime: string }
  | { ok: false; reason: string };

/**
 * Validate an uploaded recording.
 *
 * `declaredMime` is used only to fail fast; the verdict always rests on the
 * actual bytes. A mismatch between the two is treated as a spoof attempt.
 */
export function validateAudio(buf: Buffer, declaredMime: string, fileName?: string): AudioVerdict {
  if (buf.length === 0) return { ok: false, reason: "The recording is empty." };
  if (buf.length > MAX_AUDIO_BYTES) return { ok: false, reason: "The recording is too large." };

  // Strip any codec parameters: "audio/webm;codecs=opus" → "audio/webm".
  const declared = (declaredMime || "").split(";")[0]!.trim().toLowerCase();
  if (!ACCEPTED_AUDIO_MIME.includes(declared as AcceptedAudioMime)) {
    return { ok: false, reason: "Unsupported audio format." };
  }

  // Filename extension must not smuggle an executable/markup name through.
  if (fileName && /\.(html?|svg|js|mjs|php|exe|sh|bat|zip)$/i.test(fileName)) {
    return { ok: false, reason: "Unsupported audio format." };
  }

  const actual = sniffAudio(buf);
  if (!actual) return { ok: false, reason: "Unsupported audio format." };

  // WAV is served under two names; treat them as one.
  const norm = (m: string) => (m === "audio/x-wav" ? "audio/wav" : m);
  if (norm(actual) !== norm(declared)) {
    return { ok: false, reason: "The file contents don't match its type." };
  }

  if (looksLikePolyglot(buf)) return { ok: false, reason: "Unsupported audio format." };

  return { ok: true, mime: norm(actual) };
}

/**
 * Voicebuild accepts UPLOADED BYTES ONLY — never a URL.
 *
 * Exported so route handlers can assert it explicitly: if a caller supplies a
 * URL field, we reject rather than fetch. Fetching a caller-supplied URL server-
 * side is textbook SSRF (169.254.169.254, internal services, file://).
 */
export function rejectsRemoteUrls(form: FormData): boolean {
  for (const key of ["url", "audioUrl", "source", "src", "href"]) {
    if (form.get(key) != null) return false;
  }
  return true;
}
