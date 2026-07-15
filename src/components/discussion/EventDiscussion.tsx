"use client";

import { useMemo, useState } from "react";
import { MessagesSquare, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiscussionPost as Post, DiscussionPrompt as Prompt } from "@/lib/domain/types";
import {
  filterPosts,
  sortPosts,
  type DiscussionPhaseFilter,
  type DiscussionSort,
} from "@/lib/services/discussion";
import { EmptyState } from "@/components/ui/EmptyState";
import { DiscussionPost } from "./DiscussionPost";
import { DiscussionPrompt } from "./DiscussionPrompt";

export interface BoutOption {
  fightId: string;
  label: string;
}

const SORTS: { id: DiscussionSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "most-discussed", label: "Most discussed" },
  { id: "most-respected", label: "Most respected" },
];

const PHASES: { id: DiscussionPhaseFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pre-event", label: "Pre-event" },
  { id: "live", label: "Live" },
  { id: "post-event", label: "Post-event" },
];

/**
 * The event's single discussion surface. One thread per event with bout-specific
 * filters, phase filters and sorting. Posting is gated behind auth; the composer
 * and reply affordances are skeletons over the placeholder discussion service.
 */
export function EventDiscussion({
  eventId,
  posts,
  prompts,
  bouts,
  threadTitle,
  authenticated = false,
}: {
  eventId: string;
  posts: Post[];
  prompts: Prompt[];
  bouts: BoutOption[];
  threadTitle: string;
  authenticated?: boolean;
}) {
  const [sort, setSort] = useState<DiscussionSort>("newest");
  const [phase, setPhase] = useState<DiscussionPhaseFilter>("all");
  const [fightId, setFightId] = useState<string | "all">("all");
  const [draft, setDraft] = useState("");

  const boutLabel = useMemo(() => new Map(bouts.map((b) => [b.fightId, b.label])), [bouts]);

  const visible = useMemo(() => {
    const filtered = filterPosts(posts, {
      eventId,
      sort,
      phase,
      fightId: fightId === "all" ? undefined : fightId,
    });
    return sortPosts(filtered, sort);
  }, [posts, eventId, sort, phase, fightId]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">{threadTitle}</h2>
        <p className="text-[11px] text-faint">One thread for the whole event · {posts.length} posts</p>
      </div>

      {/* Prompts rail */}
      {prompts.length > 0 ? (
        <div>
          <p className="eyebrow mb-2">Start the conversation</p>
          <div className="no-scrollbar swipe-x -mx-4 flex gap-2 overflow-x-auto px-4">
            {prompts.map((prompt) => (
              <DiscussionPrompt
                key={prompt.id}
                prompt={prompt}
                onSelect={(p) => setDraft(p.text + "\n\n")}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Composer / auth gate */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="flex items-start gap-2">
          <PenLine className="mt-2 h-4 w-4 shrink-0 text-faint" aria-hidden />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={authenticated ? "Share your take on this event…" : "Sign in to join the discussion"}
            disabled={!authenticated}
            className="w-full resize-none rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-faint disabled:cursor-not-allowed"
          />
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          {!authenticated ? (
            <span className="mr-auto text-[11px] text-muted">You must be signed in to post.</span>
          ) : null}
          <button
            type="button"
            disabled={!authenticated || draft.trim().length === 0}
            className="rounded-lg bg-blood-500 px-4 py-1.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-[0_8px_30px_-12px_rgba(225,29,42,0.8)] transition-colors hover:bg-blood-400 disabled:opacity-40"
          >
            {authenticated ? "Post" : "Sign in"}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2">
        <FilterRail
          options={PHASES.map((p) => ({ id: p.id, label: p.label }))}
          active={phase}
          onChange={(id) => setPhase(id as DiscussionPhaseFilter)}
        />
        {bouts.length > 0 ? (
          <FilterRail
            options={[{ id: "all", label: "All bouts" }, ...bouts.map((b) => ({ id: b.fightId, label: b.label }))]}
            active={fightId}
            onChange={setFightId}
          />
        ) : null}
        <div className="flex items-center gap-1.5">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                sort === s.id ? "bg-fg text-bg" : "bg-surface text-muted hover:text-fg",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Posts */}
      {visible.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="h-6 w-6" />}
          title="No posts here yet"
          description="Nothing matches these filters. Be the first to weigh in, or widen the filters above."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((post) => (
            <DiscussionPost
              key={post.id}
              post={post}
              boutTag={post.fightId ? boutLabel.get(post.fightId) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRail({
  options,
  active,
  onChange,
}: {
  options: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="no-scrollbar swipe-x flex gap-1.5 overflow-x-auto">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          style={{ scrollSnapAlign: "start" }}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            active === opt.id ? "border-brand bg-brand/15 text-brand" : "border-border text-muted hover:text-fg",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
