"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2 } from "lucide-react";

export function GymClaimForm({ slug, gymName }: { slug: string; gymName: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evidence: String(fd.get("evidence") ?? "").trim(),
          note: String(fd.get("note") ?? "").trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "Could not file the claim."); return; }
      setDone(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-2xl border border-up/40 bg-up/10 p-5 text-center">
        <CheckCircle2 className="mx-auto size-7 text-up" />
        <p className="mt-2.5 font-display text-base font-bold uppercase tracking-wide text-chalk">Claim filed</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-mist">
          We&apos;ll review it and get back to you. {gymName}&apos;s page is unchanged until then.
        </p>
        <Link href={`/gyms/${slug}`} className="mt-4 inline-flex text-sm font-semibold text-blood-300 underline-offset-2 hover:underline">
          Back to the gym
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3.5">
      <label className="block">
        <span className="mb-1.5 block font-display text-[0.72rem] font-bold uppercase tracking-wide text-mist">
          How can we verify you?
        </span>
        <textarea
          name="evidence"
          required
          minLength={10}
          maxLength={600}
          rows={4}
          placeholder="Your role at the gym, an email on the gym's domain, the gym's social account, a phone number we can call…"
          className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block font-display text-[0.72rem] font-bold uppercase tracking-wide text-mist">
          Anything else <span className="font-sans font-normal normal-case tracking-normal text-fog">Optional</span>
        </span>
        <textarea
          name="note"
          maxLength={300}
          rows={2}
          className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-chalk focus:border-ink-600 focus:outline-none"
        />
      </label>

      {error && (
        <p className="rounded-xl border border-down/40 bg-down/10 px-3.5 py-3 text-sm text-down">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="tap inline-flex items-center justify-center gap-2 rounded-xl bg-blood-500 px-5 py-3 font-display text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-blood-400 disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        Submit claim
      </button>
    </form>
  );
}
