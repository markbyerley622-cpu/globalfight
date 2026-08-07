"use client";

import { Fragment } from "react";
import Link from "next/link";
import { segmentBody, type Segment } from "@/lib/rich-text/segment";
import type { RichEntity } from "@/lib/rich-text/types";

// ════════════════════════════════════════════════════════════════════════════
//  EntityText — the ONE renderer for user-authored bodies.
//
//  ── What changed ─────────────────────────────────────────────────────────
//  The old RichText regex-scanned every body on every render and produced a
//  <span data-mention> — styled like a link, behaving like nothing. A mention
//  was not clickable anywhere in this product.
//
//  This renders from SEGMENTS. It makes no decision about what a span means;
//  lib/entities/segment already reconciled structured entities against the
//  legacy parser, so there is exactly one place that knows the precedence.
//
//  ── Structured vs legacy, visibly the same ────────────────────────────────
//  Both render identically on purpose — this pass is not allowed to change how
//  anything looks. The difference is underneath: a structured mention links by
//  the user's CURRENT handle (refreshed on read, so a rename follows it), and a
//  legacy one links by the handle frozen in the text, which is the best that
//  can be done for content written before ids were stored.
// ════════════════════════════════════════════════════════════════════════════

/** Where a mention points. Null when there is nothing to point at. */
function mentionHref(entity: RichEntity): string | null {
  const username = entity.hint?.username;
  // No handle means a deleted account, or a hydrate that found nothing. The
  // text still renders — the sentence was written around it — but a link to
  // /u/undefined is worse than no link.
  return username ? `/u/${username}` : null;
}

function renderSegment(seg: Segment, key: number) {
  if (seg.kind === "text") return <Fragment key={key}>{seg.text}</Fragment>;

  if (seg.kind === "link") {
    return (
      <a
        key={key}
        href={seg.href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:decoration-sky-300"
      >
        {seg.text}
      </a>
    );
  }

  const href = mentionHref(seg.entity);
  const className = "font-semibold text-blood-300 hover:underline";

  if (!href) {
    return (
      <span key={key} className="font-semibold text-blood-300/70" title="This account is no longer available">
        {seg.text}
      </span>
    );
  }

  return (
    <Link
      key={key}
      href={href}
      className={className}
      // The CURRENT handle, refreshed from the id on read — so a hover card
      // attached later has a stable hook and a rename has already been applied
      // by the time this renders. The raw id stays server-side: /api/users/search
      // withholds primary keys and the DOM should not undo that.
      data-mention={seg.entity.hint?.username}
      // Structured spans survive a rename; legacy ones cannot. Exposed so a
      // future hover card knows which guarantee it is working with.
      data-structured={seg.legacy ? undefined : "1"}
    >
      {seg.text}
    </Link>
  );
}

export function EntityText({
  text, entities, className,
}: {
  text: string;
  /** Stored entities. Absent/empty falls back to the legacy parser. */
  entities?: unknown;
  className?: string;
}) {
  const lines = segmentBody(text, entities);
  return (
    <p className={className}>
      {lines.map((segs, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {segs.map(renderSegment)}
        </Fragment>
      ))}
    </p>
  );
}
