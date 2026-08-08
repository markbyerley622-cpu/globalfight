"use client";

import { createElement, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { subscribeEntity, type EntityState } from "@/lib/rich-text/cache";
import { entityDisplayName, type EntityPlugin } from "@/lib/rich-text/registry";
import type { RichEntity } from "@/lib/rich-text/types";
import { previewView } from "./registry";
import { PreviewAction, PreviewActions, PreviewHeader } from "./parts";

// ── The view manifest ───────────────────────────────────────────────────────
//  Same contract as lib/rich-text/plugins/index: importing a file is what
//  registers it, and a test fails if a file in this directory is missing here.
import "./mention";
import "./fighter";
import "./event";
import "./gym";
import "./promotion";

// ════════════════════════════════════════════════════════════════════════════
//  The card SHELL — states, not content.
//
//  Loading, missing and error look the same for every kind, so they are solved
//  once here and no per-kind view ever writes a spinner. A view is handed a
//  loaded DTO and nothing else, which is what keeps the five of them short
//  enough to read in one screen.
//
//  ── Why the header renders before the data ────────────────────────────────
//  The entity's HINT already carries a display name — it was stored at write
//  time and refreshed on read. So a card opens with the right name immediately
//  and fills in beneath it, rather than showing a blank box that jumps. On a
//  warm cache there is no loading state at all.
// ════════════════════════════════════════════════════════════════════════════

export function EntityPreviewCard({
  entity, plugin,
}: {
  entity: RichEntity;
  plugin: EntityPlugin;
}) {
  const [state, setState] = useState<EntityState>({ status: "idle" });

  // Subscribing is what triggers the fetch, and unsubscribing is what aborts it
  // when the card closes before the answer lands — see lib/rich-text/cache.
  useEffect(() => subscribeEntity(entity, setState), [entity]);

  // The hint already carries a display-safe name — see entityDisplayName for
  // why that is true and why the fallback chain lives in one function.
  const fallbackName = entityDisplayName(entity, "Loading…");
  const href = plugin.href(entity);

  if (state.status === "ready") {
    const View = previewView(entity.type);
    // ── createElement, not <View />, and the difference is not stylistic ──
    // JSX with a capitalised variable is how a component DEFINED during render
    // looks, and that is a real bug — such a component is a new type on every
    // render and React remounts it, resetting its state. The lint rule cannot
    // tell that apart from a registry lookup by reading the call site.
    //
    // This is a lookup: `previewView` reads a module-level Map populated once
    // at import, so the reference is stable across every render for a given
    // kind, and the kind of an open card never changes. createElement states
    // that plainly — a type resolved at runtime — rather than dressing a
    // dispatch up as a literal element and then having to argue it away.
    if (View) return createElement(View, { preview: state.preview, stale: state.stale });

    // A previewable kind with no registered view. Not a crash: the generic body
    // still names the thing and still links to it, which is strictly better
    // than an empty card. The extensibility test flags this so it does not go
    // unnoticed.
    return (
      <Generic name={fallbackName} label={plugin.label} href={href} />
    );
  }

  if (state.status === "missing") {
    return (
      <div className="p-3">
        <PreviewHeader name={fallbackName} subtitle={plugin.unavailable} />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-3">
        <PreviewHeader name={fallbackName} subtitle="Couldn't load this just now." />
        {href && (
          <PreviewActions>
            <PreviewAction href={href} primary focusTarget>Open</PreviewAction>
          </PreviewActions>
        )}
      </div>
    );
  }

  // idle / loading. The name is already known from the hint, so this is a
  // skeleton under a real heading rather than an empty box.
  return (
    <div className="p-3">
      <PreviewHeader name={fallbackName} subtitle={plugin.label} />
      <p className="mt-2.5 flex items-center gap-1.5 text-2xs text-fog">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Loading…
      </p>
    </div>
  );
}

function Generic({
  name, label, href,
}: { name: string; label: string; href: string | null }) {
  return (
    <div className="p-3">
      <PreviewHeader name={name} subtitle={label} />
      {href && (
        <PreviewActions>
          <PreviewAction href={href} primary focusTarget>Open</PreviewAction>
        </PreviewActions>
      )}
    </div>
  );
}
