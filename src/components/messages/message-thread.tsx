"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Loader2, AlertCircle } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageSquare } from "lucide-react";
import { MAX_MESSAGE_LENGTH, type ConversationView, type DmMessage } from "@/lib/messages/types";
import { cn } from "@/lib/utils";

/** Poll cadence while a thread is open. Matches the forum room's feel. */
const POLL_MS = 6000;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function MessageThread({ initial }: { initial: ConversationView }) {
  const [messages, setMessages] = useState<DmMessage[]>(initial.messages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const who = initial.withUser;

  // Stick to the bottom, but ONLY when the reader is already there. Yanking
  // someone back down while they are reading history is the classic chat bug.
  const scrollToEnd = useCallback((force: boolean) => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (force || nearBottom) endRef.current?.scrollIntoView({ block: "end" });
  }, []);

  useEffect(() => { scrollToEnd(true); }, [scrollToEnd]);

  // Poll for the other side's replies. Merges by id so an optimistic message
  // is replaced rather than duplicated when the server's copy arrives.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/messages/${initial.id}`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as ConversationView;
        setMessages((prev) => {
          const server = new Map(data.messages.map((m) => [m.id, m]));
          // Keep any optimistic message the server has not acknowledged yet.
          const pending = prev.filter((m) => m.id.startsWith("tmp-") && !server.has(m.id));
          return [...data.messages, ...pending];
        });
        scrollToEnd(false);
      } catch { /* a dropped poll is not an error the reader needs to see */ }
    };
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [initial.id, scrollToEnd]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    // Optimistic: the message appears instantly and is reconciled by id.
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, body, at: new Date().toISOString(), senderId: "me", fromMe: true }]);
    setDraft("");
    setError(null);
    setSending(true);
    requestAnimationFrame(() => scrollToEnd(true));

    try {
      const res = await fetch(`/api/messages/${initial.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send that message.");
      setMessages((prev) => prev.map((m) => (m.id === tempId ? (data.message as DmMessage) : m)));
    } catch (err) {
      // Roll the optimistic message back and put the text back in the box —
      // silently dropping what someone typed is the worst outcome here.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(body);
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  const over = draft.length > MAX_MESSAGE_LENGTH;

  return (
    <div className="flex h-[calc(100dvh-var(--shell-chrome,11rem))] flex-col">
      {/* Who you are talking to — and a way back. The name and avatar link to
          their profile, per the rule that every user reference is reachable. */}
      <header className="flex items-center gap-3 border-b border-ink-800 bg-ink-950/80 px-3 py-2.5 backdrop-blur">
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="tap grid size-9 shrink-0 place-items-center rounded-lg text-mist transition-colors hover:bg-ink-800 hover:text-chalk sm:hidden"
        >
          <ArrowLeft className="size-5" />
        </Link>
        {who?.username ? (
          <Link href={`/u/${who.username}`} className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80">
            <ForumAvatar name={who.name} image={who.image} size="md" />
            <span className="min-w-0">
              <span className="block truncate font-display text-sm font-bold text-chalk">{who.name}</span>
              <span className="block truncate text-xs text-fog">@{who.username}</span>
            </span>
          </Link>
        ) : (
          <span className="flex min-w-0 items-center gap-2.5">
            <ForumAvatar name={who?.name ?? "Member"} image={who?.image} size="md" />
            <span className="truncate font-display text-sm font-bold text-chalk">{who?.name ?? "Member"}</span>
          </span>
        )}
      </header>

      {/* The conversation */}
      <div ref={listRef} className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-6" />}
            title={`Say something to ${who?.name ?? "them"}`}
            body="This is the start of your conversation. Messages here are private to the two of you."
            compact
          />
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayLabel(prev.at) !== dayLabel(m.at);
            // Group consecutive messages from the same person — a timestamp on
            // every line turns a conversation into a log file.
            const grouped = !newDay && prev?.fromMe === m.fromMe;
            return (
              <div key={m.id}>
                {newDay && (
                  <p className="py-3 text-center text-[0.65rem] font-semibold uppercase tracking-wider text-fog">
                    {dayLabel(m.at)}
                  </p>
                )}
                <div className={cn("flex", m.fromMe ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-2.5")}>
                  <div
                    className={cn(
                      "max-w-[min(80%,32rem)] rounded-2xl px-3.5 py-2",
                      m.fromMe
                        ? "rounded-br-md bg-blood-500 text-white"
                        : "rounded-bl-md border border-ink-700 bg-ink-850 text-chalk",
                      m.id.startsWith("tmp-") && "opacity-70",
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p>
                    <p className={cn("mt-0.5 text-right text-[0.6rem] tabular-nums", m.fromMe ? "text-white/70" : "text-fog")}>
                      {timeLabel(m.at)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 border-t border-blood-500/30 bg-blood-500/10 px-3 py-2 text-xs text-blood-300">
          <AlertCircle className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      {/* Composer */}
      <form onSubmit={send} className="flex items-end gap-2 border-t border-ink-800 bg-ink-950/80 p-3 backdrop-blur">
        <label htmlFor="dm-body" className="sr-only">Message</label>
        <textarea
          id="dm-body"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — what every messenger does.
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(e as unknown as React.FormEvent); }
          }}
          rows={1}
          placeholder={`Message ${who?.name ?? ""}…`}
          className="max-h-32 min-h-[2.75rem] flex-1 resize-y rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-blood-500/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending || over}
          aria-label="Send message"
          className="tap grid size-11 shrink-0 place-items-center rounded-xl bg-blood-500 text-white transition-colors hover:bg-blood-400 disabled:cursor-not-allowed disabled:bg-ink-800 disabled:text-fog"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </form>
      {over && (
        <p className="px-3 pb-2 text-xs text-blood-300">
          {draft.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()} characters.
        </p>
      )}
    </div>
  );
}
