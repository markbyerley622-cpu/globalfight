"use client";

import Image from "next/image";
import { BadgeCheck } from "lucide-react";
import type { EntityTone } from "@/lib/rich-text/registry";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  ONE row in the composer's "@" menu, for ANY kind of entity.
//
//  ── What it knows ────────────────────────────────────────────────────────
//  Four strings and a tone token. It does not know what a fighter is, what an
//  event is, or that either exists — the server returns generic
//  `EntitySuggestion` fields and the plugin supplies the tone. That is the
//  whole point: adding a kind must not touch the picker, and
//  __tests__/composer-extensibility fails if this file or the Composer names a
//  kind.
//
//  ── Why a mark rather than a per-kind icon ───────────────────────────────
//  An icon per kind would be a map from kind to component, which is a switch in
//  a different shape and a third thing to register. The mark is the row's own
//  image when it has one (an avatar, a poster, a logo) and its initial in the
//  kind's tone when it does not — so a fighter and an event are still
//  instantly distinguishable, by colour and by the group they sit under, with
//  nothing kind-specific in this file.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tone → the mark's colours.
 *
 * Deliberately the same token set EntityText renders chips from, so a fighter
 * picked from this menu is the same colour as the chip it becomes. A reader
 * learns the mapping once.
 */
const TONE_MARK: Record<EntityTone, string> = {
  person: "bg-blood-500/15 text-blood-300",
  fighter: "bg-gold-500/15 text-gold-300",
  event: "bg-volt-500/15 text-volt-400",
  place: "bg-sky-500/15 text-sky-300",
  org: "bg-ink-700 text-mist",
};

export interface SuggestionRowProps {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  verified?: boolean;
  tone: EntityTone;
  /** People are round; events and places are not. */
  round: boolean;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  id: string;
}

export function EntitySuggestionRow({
  title, subtitle, imageUrl, verified, tone, round, active, onPick, onHover, id,
}: SuggestionRowProps) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      // pointerDown, not click: `click` fires after `blur`, and the blur would
      // have already torn the menu down.
      onPointerDown={(e) => { e.preventDefault(); onPick(); }}
      onMouseEnter={onHover}
      className={cn(
        "tap flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
        active ? "bg-blood-500/15 text-chalk" : "text-mist hover:bg-ink-800",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center overflow-hidden",
          round ? "rounded-full" : "rounded-md",
          imageUrl ? "bg-ink-900" : TONE_MARK[tone],
        )}
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            width={32}
            height={32}
            className="size-full object-cover"
            // Posters and avatars sit on arbitrary hosts; the optimiser is not
            // in front of every one of them.
            unoptimized
          />
        ) : (
          <span className="font-display text-xs font-black">
            {title.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate font-display text-sm font-bold text-chalk">{title}</span>
          {verified && <BadgeCheck aria-label="Verified" className="size-3.5 shrink-0 text-volt-400" />}
        </span>
        {subtitle && <span className="block truncate text-xs text-fog">{subtitle}</span>}
      </span>
    </button>
  );
}
