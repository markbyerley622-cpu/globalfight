"use client";

import { useEffect, useState } from "react";
import { Loader2, MessagesSquare } from "lucide-react";
import { ThreadDiscussion } from "@/components/forums/thread-discussion";
import type { RoomThreadRef } from "@/lib/community/room-types";

/**
 * The event's general room — card-wide talk, provisioned on open. Deliberately
 * the same ThreadDiscussion the fight rooms use; the only difference is scope.
 * Sits BELOW the fight card, because a bout's argument belongs in that bout's
 * arena and this is for everything else.
 */
export function EventGeneralRoom({ slug }: { slug: string }) {
  const [state, setState] = useState<{ status: "loading" | "error" | "ready"; room?: RoomThreadRef }>({ status: "loading" });

  useEffect(() => {
    let live = true;
    fetch(`/api/events/${encodeURIComponent(slug)}/room`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((room: RoomThreadRef) => { if (live) setState({ status: "ready", room }); })
      .catch(() => { if (live) setState({ status: "error" }); });
    return () => { live = false; };
  }, [slug]);

  if (state.status === "loading") {
    return <div className="flex items-center justify-center gap-2 py-10 text-mist"><Loader2 className="size-4 animate-spin" /> Opening the room…</div>;
  }
  if (state.status === "error" || !state.room) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-6 text-center">
        <MessagesSquare className="size-7 text-fog" />
        <p className="text-sm text-mist">Card talk is unavailable right now — try again shortly.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl">
      <ThreadDiscussion
        threadSlug={state.room.slug}
        locked={state.room.locked}
        categorySlug={state.room.categorySlug}
        placeholder="Anything about the card as a whole…"
        emptyLabel="Nothing on the card as a whole yet. Start it."
      />
    </div>
  );
}
