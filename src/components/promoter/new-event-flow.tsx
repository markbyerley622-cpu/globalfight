"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, ClipboardType, ImagePlus, Loader2, Rocket, AlertCircle } from "lucide-react";
import { DraftReview } from "@/components/promoter/draft-review";
import { blockersToPublish, type EditableDraft } from "@/lib/promoter/draft";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  UPLOAD → REVIEW → PUBLISH. Three states, one screen, no wizard chrome.
//
//  ── Why there are no steps ────────────────────────────────────────────────
//  A stepper would be honest about the implementation and wrong about the
//  experience. The promoter does ONE thing — hand over a poster — and then
//  corrects what came back. Numbering that as "Step 2 of 5" tells them there
//  are four more things to endure.
//
//  ── The perceived-speed trick, which is the whole feel ────────────────────
//  The poster is rendered from a LOCAL object URL the instant a file is picked,
//  before a single byte is uploaded. So the screen fills immediately and the
//  extraction happens behind an image the promoter is already looking at,
//  rather than behind a spinner on an empty page. Same wall-clock time; it
//  feels like a different product.
//
//  ── Paste is a first-class path, not a fallback ───────────────────────────
//  No OCR provider is configured in this deployment, and even with one, plenty
//  of promoters have the card as text already (press release, ticketing page,
//  a message from the matchmaker). Pasting runs the SAME parser to the same
//  draft with none of OCR's failure modes, so it is offered as a peer of
//  uploading rather than hidden behind an error.
// ════════════════════════════════════════════════════════════════════════════

type Phase = "start" | "reading" | "review" | "publishing" | "done";

export function NewEventFlow({ ocrAvailable }: { ocrAvailable: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("start");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const objectUrl = useRef<string | null>(null);

  // Revoke the local preview URL on unmount. Object URLs pin the whole file in
  // memory until released, and a poster is a multi-megabyte image.
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  const readDraft = useCallback(async (body: FormData | string) => {
    setPhase("reading");
    setError(null);
    try {
      const res = await fetch("/api/promoter/poster", {
        method: "POST",
        ...(typeof body === "string"
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ text: body }) }
          : { body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't read that.");
        setPhase("start");
        return;
      }
      // The server sends uncertainFields as an array — a Set does not survive
      // JSON. Rehydrated here so the UI works with the shape it expects.
      setDraft({ ...data.draft, uncertainFields: new Set<string>(data.draft.uncertainFields ?? []) });
      setPhase("review");
    } catch {
      setError("Couldn't read that. Check your connection and try again.");
      setPhase("start");
    }
  }, []);

  function onFile(file: File) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    // INSTANT. The poster is on screen before the upload starts.
    objectUrl.current = URL.createObjectURL(file);
    setPosterUrl(objectUrl.current);

    const form = new FormData();
    form.append("file", file);
    void readDraft(form);
  }

  async function publish() {
    if (!draft) return;
    setPhase("publishing");
    setError(null);
    try {
      const res = await fetch("/api/promoter/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          // Sets do not serialise; the server does not need it anyway.
          uncertainFields: undefined,
          posterUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.slug) {
        setError(typeof data.error === "string" ? data.error : "Couldn't publish that event.");
        setPhase("review");
        return;
      }
      setPhase("done");
      // Long enough to register as an event, short enough not to be a wait.
      // The redirect goes to the DASHBOARD, never back into edit mode.
      setTimeout(() => router.push(`/promoter/events/${data.id}`), 1100);
    } catch {
      setError("Couldn't publish that event.");
      setPhase("review");
    }
  }

  // ── Success ────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <span className="cr-pop grid size-20 place-items-center rounded-full border-2 border-volt-500/50 bg-volt-500/15 text-volt-300">
          <Check className="size-10" strokeWidth={3} aria-hidden />
        </span>
        <div>
          <p className="font-display text-2xl font-black uppercase tracking-tight text-chalk">
            Your event is live
          </p>
          <p className="mt-1 text-sm text-fog">Taking you to your dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Start ──────────────────────────────────────────────────────────────
  if (phase === "start" || (phase === "reading" && !posterUrl)) {
    return (
      <div className="space-y-4">
        <PosterDropzone onFile={onFile} busy={phase === "reading"} />

        {error && (
          <p role="alert" className="flex items-center gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
            <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
          </p>
        )}

        {/* Paste — a peer, not a consolation prize. Led with when there is no
            OCR provider, because offering an upload that cannot work is worse
            than not offering it. */}
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3.5">
          {!pasting ? (
            <button
              type="button"
              onClick={() => setPasting(true)}
              className="tap flex min-h-11 w-full items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider text-mist transition-colors hover:text-chalk"
            >
              <ClipboardType className="size-4" aria-hidden />
              {ocrAvailable ? "Or paste the card details" : "Paste the card details"}
            </button>
          ) : (
            <div className="space-y-2">
              <label htmlFor="paste-card" className="block text-xs font-semibold text-mist">
                Paste the poster text — one thing per line
              </label>
              <textarea
                id="paste-card"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={7}
                placeholder={"IRONFORGE FIGHT NIGHT 12\nETHAN COLE vs MARCO SILVA\nJAYDEN BROOKS vs LEO RAMIREZ\nSATURDAY 14 NOVEMBER 2026\nRiverstage, Brisbane, Australia\nDOORS 6:00 PM · FIRST BELL 7:00 PM"}
                className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm text-chalk placeholder:text-ink-600 focus:border-blood-500/60 focus:outline-none"
              />
              <button
                type="button"
                disabled={!pasted.trim() || phase === "reading"}
                onClick={() => void readDraft(pasted)}
                className="tap flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blood-500 font-display text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-blood-400 disabled:bg-ink-800 disabled:text-fog"
              >
                {phase === "reading" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Build my event
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Reading, with the poster already on screen ─────────────────────────
  if (phase === "reading") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        {posterUrl && (
          <div className="relative aspect-[3/4] w-44 overflow-hidden rounded-xl border border-ink-700">
            <Image src={posterUrl} alt="" fill className="object-cover" sizes="176px" unoptimized />
            {/* A sweep across the poster, not a spinner beside it: the thing
                being worked on should look like it is being worked on. */}
            <div aria-hidden className="cr-scan absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-volt-400/25 to-transparent" />
          </div>
        )}
        <p role="status" className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-mist">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Reading your poster…
        </p>
      </div>
    );
  }

  // ── Review + publish ───────────────────────────────────────────────────
  if (!draft) return null;
  const blockers = blockersToPublish(draft);
  const busy = phase === "publishing";

  return (
    <div className="space-y-4 pb-28">
      <DraftReview draft={draft} onChange={setDraft} posterUrl={posterUrl} disabled={busy} />

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
          <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {/* ── THE ONE FORWARD ACTION ────────────────────────────────────────
          Pinned, full width, unmissable. There is no "save and continue", no
          step 4, and no confirmation dialog — a confirmation on a reversible
          action (the event can be unpublished) is pure friction, and the draft
          in front of them IS the preview a dialog would otherwise describe. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl lg:left-auto lg:right-8 lg:w-96 lg:rounded-t-2xl lg:border-x">
        <button
          type="button"
          onClick={() => void publish()}
          disabled={blockers.length > 0 || busy}
          className={cn(
            "tap flex min-h-14 w-full items-center justify-center gap-2.5 rounded-xl font-display text-base font-black uppercase tracking-wider transition-all",
            blockers.length > 0 || busy
              ? "bg-ink-800 text-fog"
              : "bg-blood-500 text-white shadow-[0_12px_40px_-12px_rgba(225,29,42,0.9)] hover:bg-blood-400 active:scale-[0.99]",
          )}
        >
          {busy
            ? <><Loader2 className="size-5 animate-spin" aria-hidden /> Publishing…</>
            : <><Rocket className="size-5" aria-hidden /> Publish event</>}
        </button>
        {blockers.length > 0 && (
          <p className="mt-1.5 text-center text-3xs text-fog">{blockers[0]}</p>
        )}
      </div>
    </div>
  );
}

/** The first thing a promoter sees. One target, one instruction. */
function PosterDropzone({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={cn(
          "flex min-h-[15rem] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors",
          dragging
            ? "border-blood-500 bg-blood-500/10"
            : "border-ink-700 bg-ink-900/40 hover:border-blood-500/50 hover:bg-ink-900/70",
        )}
      >
        <span className="grid size-14 place-items-center rounded-2xl bg-blood-500/15 text-blood-300">
          <ImagePlus className="size-7" aria-hidden />
        </span>
        <span className="font-display text-lg font-black uppercase tracking-tight text-chalk">
          Upload your poster
        </span>
        <span className="max-w-xs text-sm text-fog">
          We&apos;ll read the fighters, the date and the venue off it and build the event for you.
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Reset, so picking the SAME file again still fires a change event.
          e.target.value = "";
        }}
      />
    </div>
  );
}
