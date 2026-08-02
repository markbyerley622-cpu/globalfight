"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-client";

/**
 * "Message" on someone's profile — the ONLY way a conversation starts.
 *
 * Opening is idempotent: the endpoint upserts on the sorted pair key, so
 * pressing this twice (or both people pressing it at once) lands on the same
 * thread rather than creating a second one. That is why this can be a plain
 * button with no "do you already have a conversation?" check first.
 *
 * Signed-out visitors are sent to sign-in with a returnTo, so they come back to
 * the profile they were on rather than a generic account page.
 */
export function MessageButton({ username, name }: { username: string; name: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    if (!user) {
      router.push(`/account?returnTo=${encodeURIComponent(`/u/${username}`)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not open that conversation.");
      router.push(`/messages/${data.conversationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that conversation.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        aria-label={`Message ${name}`}
        className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs font-bold text-chalk transition-colors hover:border-ink-600 hover:bg-ink-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <MessageSquare className="size-3.5" />}
        Message
      </button>
      {error && <span role="alert" className="text-[0.65rem] text-blood-300">{error}</span>}
    </span>
  );
}
