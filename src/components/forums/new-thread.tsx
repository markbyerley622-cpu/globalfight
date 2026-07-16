"use client";

import { useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-client";
import { MediaComposer } from "@/components/forums/media-composer";
import type { ForumCategoryDTO, ForumThreadDTO, ForumAttachment } from "@/lib/forum/types";

// Post kinds a user may publish, gated by their registry role (Phase 10/11).
function kindOptions(role: string): { value: string; label: string }[] {
  const opts = [{ value: "discussion", label: "Discussion" }];
  if (role === "fighter") opts.push({ value: "fighter_post", label: "Fighter post" });
  if (role === "promoter") opts.push({ value: "promoter_post", label: "Promoter post" });
  if (["promoter", "official", "media"].includes(role)) opts.push({ value: "announcement", label: "Announcement" });
  return opts;
}

/**
 * Compose a new thread: title, body, media (images + embeds) and — for
 * fighters/promoters — a post kind that surfaces in the community feed.
 */
export function NewThreadComposer({
  fixedCategory, categories, onCreated, onCancel,
}: {
  fixedCategory?: string;
  categories: ForumCategoryDTO[];
  onCreated: (t: ForumThreadDTO) => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const t = useT();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<ForumAttachment[]>([]);
  const [category, setCategory] = useState(fixedCategory ?? categories[0]?.slug ?? "general");
  const [kind, setKind] = useState("discussion");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kinds = kindOptions(user?.registryRole ?? "fan");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/forums/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, content, categorySlug: fixedCategory ?? category, attachments, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create thread.");
      onCreated(data.thread);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-surface mb-4 space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{t("Start a thread")}</h3>
        <button type="button" onClick={onCancel} className="text-fog hover:text-chalk"><X className="size-4" /></button>
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-2.5 text-sm text-blood-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!fixedCategory && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2.5 text-sm text-chalk outline-none focus:border-blood-500/50"
          >
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        )}
        {kinds.length > 1 && (
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2.5 text-sm text-chalk outline-none focus:border-blood-500/50"
          >
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        )}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("Thread title")}
        maxLength={160}
        className="w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2.5 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("What's on your mind?")}
        rows={4}
        className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2.5 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
      />
      <MediaComposer attachments={attachments} onChange={setAttachments} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>{t("Cancel")}</Button>
        <Button type="submit" size="sm" disabled={submitting || title.trim().length < 4 || (!content.trim() && attachments.length === 0)}>
          {submitting ? <><Loader2 className="size-4 animate-spin" /> {t("Posting…")}</> : t("Post thread")}
        </Button>
      </div>
    </form>
  );
}
