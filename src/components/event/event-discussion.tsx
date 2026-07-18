"use client";

import { useEffect, useState } from "react";
import { Loader2, MessagesSquare } from "lucide-react";
import { ThreadDiscussion } from "@/components/forums/thread-discussion";

interface Thread { slug: string; categorySlug: string; locked: boolean; authorId: string }

/**
 * The event Discussion tab. Provisions the event's thread lazily (only when this
 * tab is opened) via /api/events/[slug]/discussion, then renders the real forum
 * thread. If provisioning fails, it shows a quiet unavailable state — the rest
 * of the event page is entirely unaffected.
 */
export function EventDiscussion({ slug }: { slug: string }) {
  const [state, setState] = useState<{ status: "loading" | "error" | "ready"; thread?: Thread }>({ status: "loading" });

  useEffect(() => {
    let live = true;
    fetch(`/api/events/${encodeURIComponent(slug)}/discussion`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((thread: Thread) => { if (live) setState({ status: "ready", thread }); })
      .catch(() => { if (live) setState({ status: "error" }); });
    return () => { live = false; };
  }, [slug]);

  if (state.status === "loading") {
    return <div className="flex items-center justify-center gap-2 py-10 text-mist"><Loader2 className="size-4 animate-spin" /> Loading discussion…</div>;
  }
  if (state.status === "error" || !state.thread) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-6 text-center">
        <MessagesSquare className="size-7 text-fog" />
        <p className="text-sm text-mist">Discussion is unavailable right now — try again shortly.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl">
      <ThreadDiscussion
        threadSlug={state.thread.slug}
        locked={state.thread.locked}
        threadAuthorId={state.thread.authorId}
        categorySlug={state.thread.categorySlug}
      />
    </div>
  );
}
