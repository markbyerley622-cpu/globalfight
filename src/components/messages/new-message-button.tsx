"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, SendHorizonal } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { PeoplePicker, type Person } from "@/components/people/people-picker";

/**
 * START A CONVERSATION — search, tap, you are in the thread.
 *
 * ── What this replaced ─────────────────────────────────────────────────────
 * Nothing. There was no way to begin a DM from the inbox at all. The empty
 * state said "start from someone's profile" and the populated inbox repeated it
 * as a footnote, so messaging someone required knowing their handle, navigating
 * to /u/<handle>, and finding the Message button there. An inbox that cannot
 * open a conversation is a mailbox with no pen.
 *
 * The write it performs is the SAME idempotent open the profile button uses
 * (POST /api/messages, keyed on a sorted pairKey with a unique index), so
 * reaching the same person from two entry points can only ever land in one
 * thread — including when both people press it simultaneously.
 */
export function NewMessageButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(person: Person) {
    setBusy(person.username);
    setError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // By HANDLE, never an internal id — the picker is never given a
        // primary key, and the route resolves it.
        body: JSON.stringify({ username: person.username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.conversationId) {
        // The server's own words where it has any: "You can't message
        // yourself." is actionable, and flattening it would leave the reader
        // tapping the same row again.
        setError(typeof data.error === "string" ? data.error : "Could not open that conversation.");
        return;
      }
      // The sheet is left open on purpose until the route commits — closing
      // first shows the reader an empty inbox for a beat, which reads as the
      // tap having failed.
      router.push(`/messages/${data.conversationId}`);
    } catch {
      setError("Could not open that conversation.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        className="tap inline-flex min-h-11 items-center gap-2 rounded-lg bg-blood-500 px-4 font-display text-xs font-black uppercase tracking-wider text-white shadow-[0_8px_24px_-10px_rgba(225,29,42,0.85)] transition-colors hover:bg-blood-400"
      >
        <MessageSquarePlus className="size-4" aria-hidden /> New message
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="New message">
        <PeoplePicker
          onPick={(p) => void start(p)}
          busy={busy}
          error={error}
          autoFocus
          emptyHint="Follow a few people and they'll show up here — or search for a handle."
          action={<SendHorizonal className="size-4 shrink-0 text-blood-400" />}
        />
      </Sheet>
    </>
  );
}
