"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Loader2, AlertCircle } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageSquare } from "lucide-react";
import { MentionTextarea } from "@/components/mentions/mention-textarea";
import {
  MAX_MESSAGE_LENGTH,
  TYPING_PING_MS,
  type ConversationView,
  type DmMessage,
} from "@/lib/messages/types";
import { cn } from "@/lib/utils";

/**
 * Poll cadence while a thread is open and VISIBLE.
 *
 * Was 6s. Halved because the poll now also carries the other side's typing
 * state, and a "typing…" indicator that can be six seconds stale is worse than
 * none — it appears after the message it was predicting has already arrived.
 *
 * The extra request rate is paid for by pausing entirely when the tab is
 * hidden, which the previous version did not do: a backgrounded thread polled
 * forever, and each poll also wrote a read-receipt.
 */
const POLL_MS = 3000;

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
  const [otherTyping, setOtherTyping] = useState(initial.otherTyping);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** When we last told the server we are composing. Throttles the ping. */
  const lastPing = useRef(0);

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

  // Poll for the other side's replies and their typing state. Merges by id so
  // an optimistic message is replaced rather than duplicated when the server's
  // copy arrives.
  //
  // Runs ONLY while the tab is visible. A backgrounded thread has nobody
  // reading it, and every poll is also a read-receipt WRITE — so a thread left
  // open in another tab used to keep a phone awake to record that a message
  // nobody was looking at had been read.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/messages/${initial.id}`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as ConversationView;
        setOtherTyping(data.otherTyping);
        setMessages((prev) => {
          const server = new Map(data.messages.map((m) => [m.id, m]));
          // Keep any optimistic message the server has not acknowledged yet.
          const pending = prev.filter((m) => m.id.startsWith("tmp-") && !server.has(m.id));
          return [...data.messages, ...pending];
        });
        scrollToEnd(false);
      } catch { /* a dropped poll is not an error the reader needs to see */ }
    };

    const start = () => { if (!timer) timer = setInterval(tick, POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Catch up IMMEDIATELY on return rather than waiting out a full
        // interval — otherwise the first thing someone sees coming back to the
        // tab is a conversation that is up to three seconds out of date.
        void tick();
        start();
      } else {
        stop();
        // Their indicator cannot be trusted while we were not listening.
        setOtherTyping(false);
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initial.id, scrollToEnd]);

  /**
   * Tell the other side we are composing — at most once every TYPING_PING_MS.
   *
   * Throttled on the CLIENT rather than debounced, so the signal starts on the
   * first keystroke instead of after a pause. A debounce would mean the
   * indicator only appears once someone STOPS typing, which is precisely
   * backwards.
   *
   * `keepalive` so the last ping still leaves the browser if the reader
   * navigates away mid-word. There is no "stopped typing" ping and there does
   * not need to be one: the server compares a timestamp against a TTL, so the
   * signal expires by itself.
   */
  const pingTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastPing.current < TYPING_PING_MS) return;
    lastPing.current = now;
    void fetch(`/api/messages/${initial.id}/typing`, { method: "POST", keepalive: true }).catch(() => {});
  }, [initial.id]);

  const onDraftChange = useCallback((next: string) => {
    setDraft(next);
    // Only when there is something to type. Clearing the box is not composing.
    if (next.trim()) pingTyping();
  }, [pingTyping]);

  // The event is optional: the form's onSubmit passes one, and the composer's
  // Enter handler (owned by MentionTextarea) calls this directly with none.
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
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
                  <p className="py-3 text-center text-3xs font-semibold uppercase tracking-wider text-fog">
                    {dayLabel(m.at)}
                  </p>
                )}
                <div className={cn("flex", m.fromMe ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-2.5")}>
                  <div
                    className={cn(
                      // cr-msg-in: a short rise+fade so a message ARRIVES rather
                      // than appearing between two frames. Disabled under
                      // prefers-reduced-motion (see globals).
                      "cr-msg-in max-w-[min(80%,32rem)] rounded-2xl px-3.5 py-2",
                      m.fromMe
                        ? "rounded-br-md bg-blood-500 text-white"
                        : "rounded-bl-md border border-ink-700 bg-ink-850 text-chalk",
                      // An unacknowledged optimistic message reads as in-flight
                      // rather than delivered.
                      m.id.startsWith("tmp-") && "opacity-60",
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p>
                    <p className={cn("mt-0.5 text-right text-3xs tabular-nums", m.fromMe ? "text-white/70" : "text-fog")}>
                      {timeLabel(m.at)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {/* THEY ARE TYPING.
            Rendered in the message flow rather than pinned to the header, so it
            occupies the position the incoming message is about to occupy — the
            bubble does not jump when the real one lands, it replaces it in
            place. Announced politely once, not per frame. */}
        {otherTyping && (
          <div className="mt-2.5 flex justify-start">
            <div
              role="status"
              aria-live="polite"
              className="cr-msg-in flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-ink-700 bg-ink-850 px-3.5 py-3"
            >
              <span className="sr-only">{who?.name ?? "They"} is typing</span>
              <span aria-hidden className="cr-typing-dot" />
              <span aria-hidden className="cr-typing-dot" />
              <span aria-hidden className="cr-typing-dot" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 border-t border-blood-500/30 bg-blood-500/10 px-3 py-2 text-xs text-blood-300">
          <AlertCircle className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      {/* Composer */}
      {/* pb-[env(safe-area-inset-bottom)]: on an iPhone in standalone/PWA the
          composer otherwise sits under the home indicator, so the send button
          is partly untappable — the one control the surface exists for. */}
      <form
        onSubmit={send}
        className="flex items-end gap-2 border-t border-ink-800 bg-ink-950/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
      >
        <label htmlFor="dm-body" className="sr-only">Message</label>
        {/* MentionTextarea owns Enter: it picks from the @-menu when that menu
            is open and calls onSubmit otherwise, so this surface's send
            behaviour is written as if mentions did not exist. */}
        <MentionTextarea
          id="dm-body"
          value={draft}
          onChange={onDraftChange}
          onSubmit={() => void send()}
          rows={1}
          placeholder={`Message ${who?.name ?? ""}…`}
          className="max-h-32 min-h-[2.75rem] w-full resize-y rounded-lg border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-blood-500/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending || over}
          aria-label="Send message"
          className="tap grid size-11 shrink-0 place-items-center rounded-lg bg-blood-500 text-white transition-all hover:bg-blood-400 disabled:cursor-not-allowed disabled:bg-ink-800 disabled:text-fog"
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
