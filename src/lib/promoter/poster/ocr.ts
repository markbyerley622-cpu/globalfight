// ════════════════════════════════════════════════════════════════════════════
//  OCR — the integration boundary, not a pretend reader.
//
//  HONEST STATUS: no OCR provider is provisioned for this project. This module
//  is deliberately the same shape as lib/evidence/scan.ts, which says the same
//  thing about antivirus, for the same reason: a seam that reports UNAVAILABLE
//  is worth having, and a seam that quietly returns nothing and lets the caller
//  render "we found no text on your poster" is a lie that costs a support
//  ticket every time.
//
//  ── What this does today ──────────────────────────────────────────────────
//    • defines the ONE shape every adapter returns (OcrResult);
//    • ships a null provider that returns UNAVAILABLE — never an empty success;
//    • routes to an external HTTP extractor when POSTER_OCR_URL is set, so a
//      provider can be added with an env var and no code change;
//    • accepts pasted text as a first-class input, which is a real product
//      answer and not a placeholder — see extractFromText.
//
//  ── What it does NOT do ───────────────────────────────────────────────────
//  Read an image without a provider configured. That gap is reported as a
//  status the UI must handle, not hidden behind an empty result.
//
//  ── Why the provider is not chosen here ───────────────────────────────────
//  The parser (parse.ts) is the valuable, product-specific part and it consumes
//  OcrLine[], which every candidate provider can produce: Textract, Cloud
//  Vision and Tesseract all return text plus a bounding box plus a confidence.
//  Committing to one now would buy nothing and would put a vendor SDK in the
//  dependency tree before anyone has compared their accuracy on the stylised,
//  low-contrast type that fight posters actually use.
// ════════════════════════════════════════════════════════════════════════════

import "server-only";
import { log } from "@/lib/scraper/logger";
import type { OcrLine, OcrResult } from "@/lib/promoter/poster/types";

export type OcrStatus =
  /** Text was read. `result` is present. */
  | "OK"
  /** No provider is configured. NOT the same as "no text found". */
  | "UNAVAILABLE"
  /** A provider is configured and failed or timed out. Retryable. */
  | "FAILED"
  /** The provider ran and the image genuinely carries no readable text. */
  | "EMPTY";

export type OcrOutcome =
  | { status: "OK"; result: OcrResult }
  | { status: Exclude<OcrStatus, "OK">; result: null; reason: string };

/** Generous: a dense poster on a cold provider is slow, and this is one call. */
const TIMEOUT_MS = 30_000;

/**
 * Guard against a provider (or a hostile response) handing back something
 * enormous. A poster has tens of lines, not tens of thousands, and every line
 * flows into a parser that does substring work across the set.
 */
const MAX_LINES = 400;
const MAX_LINE_CHARS = 300;

/**
 * Coerce whatever an adapter returned into the contract.
 *
 * Every field is re-validated rather than trusted: `box` values outside 0–1
 * break the type-size ranking that decides which bout is the main event, and a
 * NaN confidence propagates into every score the review step shows.
 */
export function normaliseLines(input: unknown): OcrLine[] {
  if (!Array.isArray(input)) return [];
  const out: OcrLine[] = [];

  for (const raw of input.slice(0, MAX_LINES)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.slice(0, MAX_LINE_CHARS).trim() : "";
    if (!text) continue;

    const line: OcrLine = { text };

    if (typeof r.confidence === "number" && Number.isFinite(r.confidence)) {
      // Providers disagree on scale: Textract reports 0–100, Vision 0–1.
      // Normalise here so the parser never has to know which one ran.
      const c = r.confidence > 1 ? r.confidence / 100 : r.confidence;
      line.confidence = Math.max(0, Math.min(1, c));
    }

    const box = r.box as Record<string, unknown> | undefined;
    if (box && ["top", "left", "width", "height"].every((k) => typeof box[k] === "number" && Number.isFinite(box[k] as number))) {
      const height = box.height as number;
      // A non-positive height would sort as the smallest type on the poster and
      // silently demote whatever it belongs to — usually the main event.
      if (height > 0) {
        line.box = {
          top: box.top as number,
          left: box.left as number,
          width: box.width as number,
          height,
        };
      }
    }

    out.push(line);
  }

  return out;
}

/**
 * Pasted or typed poster text.
 *
 * A real input, not a stopgap. Promoters routinely have the card as text
 * already — in the press release, the ticketing listing, a WhatsApp message —
 * and pasting it runs the same parser to the same result with none of OCR's
 * error modes. It is also the path that makes the whole pipeline testable and
 * demoable with no provider at all.
 *
 * No geometry, so the parser falls back to reading order. That is exactly what
 * it is designed to degrade to.
 */
export function extractFromText(text: string): OcrOutcome {
  const lines = normaliseLines(
    text.split(/\r?\n/).map((t) => ({ text: t })).filter((l) => l.text.trim()),
  );

  if (lines.length === 0) {
    return { status: "EMPTY", result: null, reason: "There was no text to read." };
  }
  return { status: "OK", result: { lines, provider: "pasted-text" } };
}

/**
 * Read an image.
 *
 * Returns UNAVAILABLE when nothing is configured — never a successful empty
 * result. The caller must branch on the status and offer the paste path.
 */
export async function extractFromImage(bytes: Buffer, contentType: string): Promise<OcrOutcome> {
  const url = process.env.POSTER_OCR_URL;
  if (!url) {
    return {
      status: "UNAVAILABLE",
      result: null,
      reason: "Automatic poster reading isn't set up yet. You can paste the card details instead.",
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": contentType,
        // Optional shared secret. Absent in the common case where the extractor
        // is a private sidecar not reachable from outside the network.
        ...(process.env.POSTER_OCR_TOKEN
          ? { authorization: `Bearer ${process.env.POSTER_OCR_TOKEN}` }
          : {}),
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      log.warn({ status: res.status }, "poster-ocr:provider-error");
      return { status: "FAILED", result: null, reason: "Couldn't read that poster. Try again, or paste the details." };
    }

    const body = (await res.json()) as { lines?: unknown };
    const lines = normaliseLines(body.lines);
    if (lines.length === 0) {
      return { status: "EMPTY", result: null, reason: "We couldn't find any text on that image." };
    }

    return { status: "OK", result: { lines, provider: "http" } };
  } catch (e) {
    // A timeout or an unreachable extractor is NOT "no text on the poster".
    // Reporting it as FAILED is what lets the UI offer a retry instead of
    // telling the promoter their poster is blank.
    log.warn({ err: (e as Error).message }, "poster-ocr:unreachable");
    return { status: "FAILED", result: null, reason: "Couldn't read that poster. Try again, or paste the details." };
  }
}

/** Is automatic reading available at all? Lets the UI lead with the right path. */
export const isOcrConfigured = (): boolean => Boolean(process.env.POSTER_OCR_URL);
