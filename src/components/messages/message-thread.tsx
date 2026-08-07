"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Loader2, AlertCircle, Check, CheckCheck, BadgeCheck } from "lucide-react";
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
import { ChallengeCard } from "@/components/messages/challenge-card";
import { deliveryOf, type DeliveryState } from "@/lib/presence/derive";
import { useHeartbeat } from "@/lib/presence/use-presence";
import { PresenceDot, PresenceLabel } from "@/components/presence/presence-dot";
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

/** One word per delivery state, in one place, so no surface invents its own. */
const RECEIPT_LABEL: Record<DeliveryState, string> = {
  sending: "Sending…",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

export function MessageThread({ initial }: { initial: ConversationView }) {
  const [messages, setMessages] = useState<DmMessage[]>(initial.messages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherTyping, setOtherTyping] = useState(initial.otherTyping);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(initial.otherReadAt);
  const [otherDeliveredAt, setOtherDeliveredAt] = useState<string | null>(initial.otherDeliveredAt);
  const [otherPresence, setOtherPresence] = useState(initial.withUser?.presence ?? null);
  const [receiptsHidden, setReceiptsHidden] = useState(initial.receiptsHidden);

  // Publish "I'm here" while this thread is open and the tab is visible. This
  // is what makes the OTHER side's presence dot mean anything — presence only
  // works if both ends beat.
  useHeartbeat();
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

  /**
   * Read the thread once and apply it.
   *
   * Hoisted out of the poll effect because it now has a SECOND caller: the
   * challenge card, which needs the conversation re-read the instant somebody
   * takes a corner rather than up to three seconds later. One fetch-and-apply
   * definition means the card and the poller cannot end up merging server state
   * two different ways.
   */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/${initial.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ConversationView;
      setOtherTyping(data.otherTyping);
      setOtherReadAt(data.otherReadAt);
      setOtherDeliveredAt(data.otherDeliveredAt);
      setOtherPresence(data.withUser?.presence ?? null);
      setReceiptsHidden(data.receiptsHidden);
      setMessages((prev) => {
        const server = new Map(data.messages.map((m) => [m.id, m]));
        // Keep any optimistic message the server has not acknowledged yet.
        const pending = prev.filter((m) => m.id.startsWith("tmp-") && !server.has(m.id));
        return [...data.messages, ...pending];
      });
      scrollToEnd(false);
    } catch { /* a dropped poll is not an error the reader needs to see */ }
  }, [initial.id, scrollToEnd]);

  // Poll for the other side's replies and their typing state. Merges by id so
  // an optimistic message is replaced rather than duplicated when the server's
  // copy arrives.
  //
  // Runs ONLY while the tab is visible. A backgrounded thread has nobody
  // reading it, and every poll is also a read-receipt WRITE — so a thread left
  // open in another tab used to keep a phone awake to record that a message
  // nobody was looking at had been read.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => void refresh();

    const start = () => { if (!timer) timer = setInterval(tick, POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Catch up IMMEDIATELY on return rather than waiting out a full
        // interval — otherwise the first thing someone sees coming back to the
        // tab is a conversation that is up to three seconds out of date.
        tick();
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
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

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
    setMessages((prev) => [...prev, {
      id: tempId, body, at: new Date().toISOString(), senderId: "me", fromMe: true,
      kind: "TEXT" as const, challenge: null,
    }]);
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

  /**
   * The receipt goes on the LAST message I sent, and nowhere else.
   *
   * ── Why only one ─────────────────────────────────────────────────────────
   * Reading is a watermark, so if my most recent message has been read then
   * every earlier one has too. Stamping "Read" on all of them says the same
   * thing many times and turns the thread into a column of status text; one
   * marker at the bottom carries the whole fact. It is also how every messenger
   * people already use behaves, so it needs no explaining.
   */
  const lastMineIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].fromMe) return i;
    return -1;
  })();
  const lastMine = lastMineIndex >= 0 ? messages[lastMineIndex] : null;
  // Sending → Sent → Delivered → Read, derived by the shared function so the
  // thread and any future surface answer this identically. Every state is a
  // fact somebody's client actually caused — see DeliveryState.
  const receipt: DeliveryState | null = lastMine
    ? deliveryOf({
        at: lastMine.at,
        optimistic: lastMine.id.startsWith("tmp-"),
        otherDeliveredAt,
        otherReadAt,
      })
    : null;

  return (
    // ── Width ──
    // A conversation is a READING column, not a dashboard. Full-bleed, the
    // composer's bar and its border ran the entire width of a desktop monitor
    // while the bubbles it belonged to sat in the middle third — the bar read as
    // page furniture rather than as part of the thread.
    //
    // `max-w-3xl` is wider than any phone, so this is inert on mobile: the
    // layout there is unchanged and still edge-to-edge. The frame only appears
    // at `lg`, where there is room around it for one to make sense.
    <div className="mx-auto flex h-[calc(100dvh-var(--shell-chrome,11rem))] w-full max-w-3xl flex-col overflow-hidden lg:my-4 lg:h-[calc(100dvh-var(--shell-chrome,11rem)-2rem)] lg:rounded-2xl lg:border lg:border-ink-800 lg:shadow-[0_24px_60px_-30px_rgba(0,0,0,0.95)]">
      {/* Who you are talking to — and a way back. The name and avatar link to
          their profile, per the rule that every user reference is reachable. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-950/80 px-3 py-2.5 backdrop-blur">
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="tap grid size-9 shrink-0 place-items-center rounded-lg text-mist transition-colors hover:bg-ink-800 hover:text-chalk sm:hidden"
        >
          <ArrowLeft className="size-5" />
        </Link>
        {/* The second line is a STATUS line, not a handle.
            "@markb" never changes and is one tap away on their profile;
            "typing…" / "Active now" / "Active 12m ago" is the thing a person
            actually wants from the top of a conversation, and it is the answer
            to "should I wait for a reply?". Typing outranks presence because it
            is strictly newer information. */}
        {who?.username ? (
          <Link href={`/u/${who.username}`} className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80">
            <span className="relative shrink-0">
              <ForumAvatar name={who.name} image={who.image} size="md" />
              <PresenceDot presence={otherPresence} ringClassName="border-ink-950" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1">
                <span className="truncate font-display text-sm font-bold text-chalk">{who.name}</span>
                {who.verified && <BadgeCheck className="size-3.5 shrink-0 text-volt-400" aria-label="Verified" />}
              </span>
              <PresenceLabel presence={otherPresence} typing={otherTyping} className="block truncate" />
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
        ) : messages.length === 1 && messages[0].kind === "CHALLENGE" ? (
          // ── A conversation that STARTED with a challenge ──────────────────
          // Dropping somebody into a thread containing one card and nothing else
          // reads as a broken screen. This says why the thread exists and what
          // to do with it, then renders the card underneath — so the first
          // impression of a brand-new conversation is an invitation to talk
          // rather than an empty room.
          <>
            <p className="px-1 pt-2 text-center text-2xs leading-relaxed text-fog">
              {messages[0].fromMe
                ? `You challenged ${who?.name ?? "them"}. Talk it out here — the battle settles at the bell.`
                : `${who?.name ?? "They"} challenged you. Take the other corner, then tell them why they're wrong.`}
            </p>
            <div className={cn("mt-2.5 flex", messages[0].fromMe ? "justify-end" : "justify-start")}>
              {messages[0].challenge && (
                <ChallengeCard
                  challenge={messages[0].challenge}
                  body={messages[0].body}
                  fromMe={messages[0].fromMe}
                  onAnswered={() => void refresh()}
                />
              )}
            </div>
          </>
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
                  {/* A rich message renders as ITSELF, not inside a chat bubble
                      — a card in a rounded blood-red speech bubble reads as a
                      quoted image rather than as a thing you can act on. The
                      body sentence is still the card's accessible name, so the
                      message says the same thing either way. */}
                  {m.kind === "CHALLENGE" && m.challenge ? (
                    <ChallengeCard
                      challenge={m.challenge}
                      body={m.body}
                      fromMe={m.fromMe}
                      onAnswered={() => void refresh()}
                    />
                  ) : (
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
                  )}
                </div>

                {/* Read receipt — on the last message I sent, and only there. */}
                {i === lastMineIndex && receipt && (
                  <p
                    className="mt-1 flex items-center justify-end gap-1 pr-1 text-3xs text-fog"
                    // Polite, not assertive: the state changing from Sent to
                    // Read must not interrupt whatever a screen-reader user is
                    // currently hearing.
                    role="status"
                    aria-live="polite"
                  >
                    {receipt === "sending" && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
                    {receipt === "sent" && <Check className="size-3" aria-hidden />}
                    {(receipt === "delivered" || receipt === "read") && (
                      <CheckCheck
                        className={cn("size-3", receipt === "read" && "text-volt-400")}
                        aria-hidden
                      />
                    )}
                    <span className={receipt === "read" ? "text-volt-400" : undefined}>
                      {RECEIPT_LABEL[receipt]}
                    </span>
                    {/* Ticks stopping at Delivered forever reads as a bug — the
                        reader concludes the other person never opens their
                        messages, which is a worse misunderstanding than the one
                        the setting was protecting against. So say why. */}
                    {receiptsHidden && receipt === "delivered" && (
                      <span className="text-fog"> · read receipts off</span>
                    )}
                  </p>
                )}
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
      {/* NO safe-area padding here, deliberately. This composer sits inside
          #main, and BottomTabBar — which is below #main and visible at this
          breakpoint — already carries
          `pb-[calc(0.75rem+env(safe-area-inset-bottom))]`. Adding the inset
          again here would double-count it and leave a gap above the home
          indicator on exactly the devices it is meant to help. */}
      {/* Tighter on desktop: the 12px ring of padding that gives a thumb room on
          a phone just makes the bar look inflated behind a mouse pointer. */}
      <form
        onSubmit={send}
        className="flex shrink-0 items-end gap-2 border-t border-ink-800 bg-ink-950/80 p-3 backdrop-blur lg:px-3 lg:py-2"
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
          className="max-h-32 min-h-[2.75rem] w-full resize-y rounded-lg border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-blood-500/60 focus:outline-none lg:min-h-[2.5rem] lg:py-2"
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
