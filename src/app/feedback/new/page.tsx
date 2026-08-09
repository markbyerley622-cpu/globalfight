"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-client";
import {
  CATEGORIES, CATEGORY_LABEL, TITLE_MAX, BODY_MAX, TITLE_MIN, BODY_MIN,
  type FeedbackCategory,
} from "@/lib/feedback/shared";

// ════════════════════════════════════════════════════════════════════════════
//  Submitting feedback.
//
//  The limits here come from lib/feedback/shared — the SAME constants the
//  service validates against. A client-side limit on its own is a suggestion;
//  duplicating the numbers would let the two drift and produce a form that
//  accepts something the server then rejects.
// ════════════════════════════════════════════════════════════════════════════

interface Similar { id: string; title: string; status: string; _count: { votes: number } }

export default function NewFeedbackPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("IDEA");
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── "Has somebody already asked for this?" ──
  // Debounced, and deliberately advisory: it never blocks the submission. The
  // point is to let someone add their vote to an existing idea instead of
  // splitting it across two, not to police duplicates.
  useEffect(() => {
    const t = title.trim();
    // No setState in the effect BODY. The short-title case is handled at render
    // (`showSimilar` below) rather than by clearing state here — clearing it
    // synchronously is a cascading render, and it is also redundant: stale
    // results simply stop being displayed.
    if (t.length < 4 || !user) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/feedback?title=${encodeURIComponent(t)}`);
        if (res.ok) setSimilar(((await res.json()) as { similar: Similar[] }).similar ?? []);
      } catch { /* advisory only — a failure here must not interrupt typing */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [title, user]);

  // Derived, not stored: results from a longer title must not linger after the
  // field is cleared back down.
  const showSimilar = title.trim().length >= 4 ? similar : [];

  if (!loading && !user) {
    return (
      <div className="container-cr max-w-xl py-16 text-center">
        <h1 className="font-display text-lg font-black text-chalk">Sign in to post feedback</h1>
        <p className="mt-2 text-sm text-fog">The board is public to read. Posting and voting need an account.</p>
        <Link href="/account" className="tap mt-5 inline-flex min-h-11 items-center rounded-lg bg-blood-500 px-5 font-display text-2xs font-black uppercase tracking-wider text-white">
          Sign in
        </Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body, category }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) { setError(data.error ?? "That could not be posted."); return; }
      router.push(`/feedback/${data.id}`);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-cr max-w-2xl py-6">
      <Link href="/feedback" className="tap mb-4 inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-fog transition-colors hover:text-chalk">
        <ArrowLeft className="size-3.5" aria-hidden /> Back to the board
      </Link>

      <h1 className="font-display text-xl font-black text-chalk">Submit feedback</h1>
      <p className="mt-1 text-sm text-fog">
        An idea, a missing feature, something that could be better, or a bug. Everyone can see and vote on it.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-5" noValidate>
        <div>
          <label htmlFor="fb-title" className="block font-display text-2xs font-bold uppercase tracking-wide text-mist">
            Title
          </label>
          <input
            id="fb-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            required
            aria-describedby="fb-title-help"
            className="mt-1.5 h-11 w-full rounded-lg border border-ink-700 bg-ink-900 px-3.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none focus:ring-2 focus:ring-blood-500/40"
            placeholder="Make event predictions easier to find"
          />
          <p id="fb-title-help" className="mt-1 text-2xs text-fog">
            {title.trim().length}/{TITLE_MAX} · at least {TITLE_MIN} characters
          </p>
        </div>

        {showSimilar.length > 0 && (
          <div className="rounded-card border border-gold-500/30 bg-gold-500/5 p-3.5">
            <p className="font-display text-3xs font-bold uppercase tracking-[0.16em] text-gold-300">
              Similar feedback
            </p>
            <p className="mt-1 text-2xs text-fog">
              Adding your vote to one of these carries more weight than a second copy.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {showSimilar.map((s) => (
                <li key={s.id}>
                  <Link href={`/feedback/${s.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-mist hover:bg-ink-850 hover:text-chalk">
                    <span className="font-display text-2xs font-black tabular-nums text-fog">{s._count.votes}</span>
                    <span className="truncate">{s.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <fieldset>
          <legend className="font-display text-2xs font-bold uppercase tracking-wide text-mist">Category</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`tap rounded-full border px-3.5 py-2 font-display text-2xs font-bold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-500/60 ${
                  category === c
                    ? "border-blood-500 bg-blood-500/15 text-blood-300"
                    : "border-ink-700 bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk"
                }`}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="fb-body" className="block font-display text-2xs font-bold uppercase tracking-wide text-mist">
            Description
          </label>
          <textarea
            id="fb-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={BODY_MAX}
            rows={7}
            required
            aria-describedby="fb-body-help"
            className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none focus:ring-2 focus:ring-blood-500/40"
            placeholder="What would you like to see, and what would it let you do?"
          />
          <p id="fb-body-help" className="mt-1 text-2xs text-fog">
            {body.trim().length}/{BODY_MAX} · at least {BODY_MIN} characters
          </p>
        </div>

        {error && (
          // role=alert so it is announced when it appears, not only when focused.
          <p role="alert" className="rounded-lg border border-blood-500/40 bg-blood-500/10 px-3.5 py-2.5 text-sm text-blood-200">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="tap inline-flex min-h-11 items-center gap-2 rounded-lg bg-blood-500 px-5 font-display text-2xs font-black uppercase tracking-wider text-white transition-colors hover:bg-blood-400 disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {saving ? "Posting…" : "Post feedback"}
          </button>
          <Link href="/feedback" className="tap inline-flex min-h-11 items-center px-4 text-2xs font-bold uppercase tracking-wide text-fog hover:text-chalk">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
