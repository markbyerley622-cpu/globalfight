"use client";

import { Fragment } from "react";
import Link from "next/link";
import { segmentBody, type Segment } from "@/lib/rich-text/segment";
import { entityPlugin, type EntityTone } from "@/lib/rich-text/registry";
import { useEntityHover } from "./hover/use-entity-hover";
import type { RichEntity } from "@/lib/rich-text/types";

// ════════════════════════════════════════════════════════════════════════════
//  EntityText — the ONE renderer for user-authored bodies.
//
//  ── What this component knows ─────────────────────────────────────────────
//  How to turn a SEGMENT into an element. That is all. It does not know what a
//  mention is, where a fighter's page lives, or which kinds have previews — it
//  asks the registry, every time, for every kind.
//
//  It previously knew: it read `entity.hint.username`, built `/u/<handle>`, and
//  hard-coded the mention colour. That is one `if` while there is one kind and
//  a switch the moment there are two — and the same switch would then have to
//  be repeated in the hover card and the prefetcher. Adding `sponsor` here
//  today costs nothing in this file; see lib/rich-text/registry.
//
//  ── Structured vs legacy, visibly the same ────────────────────────────────
//  Both render identically on purpose. The difference is underneath: a
//  structured entity routes through its plugin using a hint refreshed on read,
//  so a rename or a re-slug follows it; a legacy one routes on the handle
//  frozen in the text, which is the best that can be done for content written
//  before ids were stored.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tone → classes.
 *
 * Kept here, not in the plugins, so every entity in the product is styled from
 * one palette. A plugin picks a TOKEN; it cannot invent a colour. The `text-`
 * pairs are deliberately the accents already used by each family's own pages,
 * so a chip reads as the same thing it links to.
 */
const TONE: Record<EntityTone, string> = {
  person: "text-blood-300 decoration-blood-300/30",
  fighter: "text-gold-300 decoration-gold-300/30",
  event: "text-volt-400 decoration-volt-400/30",
  place: "text-sky-300 decoration-sky-300/30",
  org: "text-mist decoration-mist/30",
};

/** The one entity chip. Every kind renders through this — see the header. */
function EntityChip({ seg }: { seg: Extract<Segment, { kind: "entity" }> }) {
  const entity: RichEntity = seg.entity;
  const plugin = entityPlugin(entity.type);

  // Called UNCONDITIONALLY, before the unregistered-kind bail below. A hook
  // after an early return changes the hook order between renders the moment a
  // rollout starts storing a kind this bundle does not have — which React
  // reports as a crash in an unrelated component. It takes a nullable plugin
  // and hands back inert props, so the cost of that discipline is nothing.
  const hover = useEntityHover(entity, plugin);

  // An UNREGISTERED kind. Not an error: it is what a client running an older
  // bundle sees when the server has begun storing a kind that bundle has never
  // heard of. Rendering the words as plain text is exactly what already happens
  // to legacy content, so a rollout can never produce a broken-looking body.
  if (!plugin) return <>{seg.text}</>;

  const href = plugin.href(entity);
  const tone = TONE[plugin.tone];

  if (!href) {
    return (
      <span
        className={`font-semibold opacity-70 ${tone}`}
        title={plugin.unavailable}
        {...hover.props}
      >
        {seg.text}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`font-semibold underline decoration-transparent underline-offset-2 transition-colors hover:underline ${tone}`}
      // The accessible name says what KIND of thing this is. Without it a chip
      // is announced as a bare link and a reader has no way to tell a fighter
      // from the gym they train at.
      aria-label={`${seg.text.replace(/^@/, "")}, ${plugin.label}`}
      // The kind, for styling hooks and for the one-renderer test. Never the
      // id: /api/users/search withholds primary keys on purpose and the DOM
      // should not undo that decision.
      data-entity={entity.type}
      // Structured spans survive a rename; legacy ones cannot. Exposed so the
      // hover card knows which guarantee it is working with.
      data-structured={seg.legacy ? undefined : "1"}
      {...hover.props}
    >
      {seg.text}
    </Link>
  );
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

  return <EntityChip key={key} seg={seg} />;
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
