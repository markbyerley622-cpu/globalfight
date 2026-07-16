// ════════════════════════════════════════════════════════════════════════
//  User-generated MEDIA guard.
//
//  Clips, forum attachments, avatars and banners all published IMMEDIATELY:
//  Clip.status defaulted to "ready", uploads went straight to a world-readable
//  bucket, and there was no moderation state, no review queue, no report path and no
//  takedown flow anywhere in the codebase.
//
//  There is also no antivirus engine provisioned. The honest consequence is that we
//  cannot accept public media at launch: the application must REFUSE an upload rather
//  than mark an unscanned file safe and publish it to the world.
//
//  UGC_MEDIA_UPLOADS_ENABLED=false is therefore the launch default, and it fails
//  closed. TEXT community functionality (forums, comments) is unaffected — it has
//  reporting and moderation, and it carries no malware or copyright-in-a-file risk.
//
//  Identity-verification evidence is NOT covered here: it is private, never public,
//  and has its own guard (src/lib/evidence/*).
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { NextResponse } from "next/server";
import { flags } from "@/lib/feature-flags";

/**
 * Refuse a public media upload while UGC media is disabled.
 *
 * Returns a response to send, or null to proceed.
 */
export function refuseIfUgcMediaDisabled(): NextResponse | null {
  if (flags().ugcMediaUploadsEnabled) return null;

  return NextResponse.json(
    {
      error:
        "Media uploads are temporarily unavailable. We do not publish files we cannot scan and review.",
      code: "UGC_MEDIA_DISABLED",
    },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
}

/**
 * Moderation states for user media. Nothing is public until APPROVED.
 *
 * PENDING  — uploaded, quarantined, not scanned, NOT public.
 * SCANNING — with the scanner.
 * APPROVED — a human (or policy) cleared it. Only now may it be served publicly.
 * REJECTED — refused. The underlying object is DELETED, not merely hidden.
 */
export const MEDIA_STATES = ["PENDING", "SCANNING", "APPROVED", "REJECTED"] as const;
export type MediaState = (typeof MEDIA_STATES)[number];

/** Only APPROVED media may be rendered to the public. */
export function isPubliclyViewable(state: string | null | undefined): boolean {
  return state === "APPROVED";
}
