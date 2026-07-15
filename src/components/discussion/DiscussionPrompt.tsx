import { MessageCircleQuestion } from "lucide-react";
import type { DiscussionPrompt as Prompt } from "@/lib/domain/types";

/**
 * A contextual conversation starter. Tapping one would pre-fill the composer —
 * here it's a skeleton affordance (button wired to an optional handler).
 */
export function DiscussionPrompt({
  prompt,
  onSelect,
}: {
  prompt: Prompt;
  onSelect?: (prompt: Prompt) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(prompt)}
      style={{ scrollSnapAlign: "start" }}
      className="flex w-60 shrink-0 items-start gap-2 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-brand/50"
    >
      <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
      <span className="text-sm leading-snug">{prompt.text}</span>
    </button>
  );
}
