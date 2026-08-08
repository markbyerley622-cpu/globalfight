import type { ComponentType } from "react";
import type { EntityPreview } from "@/lib/rich-text/cache";

// ════════════════════════════════════════════════════════════════════════════
//  Which component draws which kind of preview.
//
//  ── Why this is separate from the entity registry ─────────────────────────
//  lib/rich-text/registry is PURE — it is imported by `sanitizeEntities`, which
//  runs on the server on every read and inside plain node unit tests. Putting
//  React components in it would drag a renderer into both. So the pure half
//  (what a kind IS: its label, its tone, where it points) lives there, and the
//  view half (what its card looks like) lives here, keyed by the same `kind`
//  string.
//
//  The two halves are checked against each other by a test: every previewable
//  kind must have a view registered here, and every view must correspond to a
//  registered kind. A card that exists for a kind nobody registered is dead
//  code; a previewable kind with no card falls back to the generic body, which
//  works but says almost nothing.
// ════════════════════════════════════════════════════════════════════════════

/** Every preview view receives the loaded DTO and nothing else. */
export interface PreviewViewProps {
  preview: EntityPreview;
  /** True while a cached answer is being refreshed behind this render. */
  stale: boolean;
}

export type PreviewView = ComponentType<PreviewViewProps>;

const VIEWS = new Map<string, PreviewView>();

export function registerPreview(kind: string, view: PreviewView): void {
  const existing = VIEWS.get(kind);
  if (existing && existing !== view) {
    throw new Error(`Two preview views registered for kind "${kind}".`);
  }
  VIEWS.set(kind, view);
}

export function previewView(kind: string): PreviewView | null {
  return VIEWS.get(kind) ?? null;
}

// ── Reading a DTO safely ────────────────────────────────────────────────────
//  The DTO crosses the network as JSON, so a view cannot assume a field is
//  present or of the right type — an older client will happily receive a shape
//  a newer server changed. These keep every view from writing the same guards.

export const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export const bool = (v: unknown): boolean => v === true;
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
