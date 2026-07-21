"use client";

import { useState } from "react";
import Link from "next/link";
import { Swords, X } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import type { Opponent } from "@/lib/picks";

const METHOD_LABEL: Record<string, string> = { KO: "KO", SUB: "Submission", UD: "Decision" };

/**
 * Prediction Battles — commit 1. Once you've picked a bout, surface someone who
 * picked the OTHER side: every prediction creates a natural adversary. Skippable
 * (your fallback rule) — dismissing it just leaves the open discussion. Matched
 * off existing picks (seed users included), so there's always an opponent without
 * live matchmaking.
 */
export function FightOpponents({
  opponents,
  theirFighter,
  discussionHref,
}: {
  opponents: Opponent[];
  theirFighter: string;
  discussionHref: string;
}) {
  const [skipped, setSkipped] = useState(false);
  if (!opponents.length || skipped) return null;

  const top = opponents[0];
  const more = opponents.length - 1;
  const displayName = top.name ?? (top.username ? `@${top.username}` : "A fan");
  const sub = [
    `backs ${theirFighter}`,
    top.method ? METHOD_LABEL[top.method] : null,
    top.confidence ? "★".repeat(top.confidence) : null,
  ].filter(Boolean).join(" · ");

  const avatar = <ForumAvatar name={top.name ?? top.username ?? "?"} image={top.image} size="sm" />;

  return (
    <div className="mt-3 rounded-xl border border-ink-700 bg-ink-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-blood-300">
          <Swords className="size-3.5" /> Someone disagrees
        </span>
        <button onClick={() => setSkipped(true)} aria-label="Skip" className="tap text-fog hover:text-chalk">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-2.5">
        {top.username ? (
          <Link href={`/u/${top.username}`} className="shrink-0 transition-opacity hover:opacity-80">{avatar}</Link>
        ) : (
          avatar
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-chalk">
            {top.username ? (
              <Link href={`/u/${top.username}`} className="hover:text-blood-300 hover:underline">{displayName}</Link>
            ) : (
              displayName
            )}
          </p>
          <p className="truncate text-xs text-fog">{sub}</p>
        </div>
        <Link
          href={discussionHref}
          className="shrink-0 rounded-lg bg-blood-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blood-600"
        >
          Debate it
        </Link>
      </div>
      {more > 0 && <p className="mt-2 text-[0.7rem] text-fog">+{more} more took the other side.</p>}
    </div>
  );
}
