"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, Upload, FileText, ShieldCheck } from "lucide-react";

export function GymClaimForm({ slug, gymName }: { slug: string; gymName: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<{ name: string; state: "uploading" | "done" | "error"; msg?: string } | null>(null);

  /** Attach proof to the claim just filed. Separate request on purpose: the
   *  claim must exist first, and a document is optional — a claim without one
   *  is still reviewable. */
  async function attach(file: File) {
    setProof({ name: file.name, state: "uploading" });
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/claim/evidence`, { method: "POST", body });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not upload.");
      setProof({ name: file.name, state: "done" });
    } catch (e) {
      setProof({ name: file.name, state: "error", msg: e instanceof Error ? e.message : "Could not upload." });
    }
  }

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
      <div className="mt-6 flex flex-col gap-3">
        <div className="rounded-2xl border border-up/40 bg-up/10 p-5 text-center">
          <CheckCircle2 className="mx-auto size-7 text-up" />
          <p className="mt-2.5 font-display text-base font-bold uppercase tracking-wide text-chalk">Claim filed</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-mist">
            We&apos;ll review it and get back to you. {gymName}&apos;s page is unchanged until then.
          </p>
        </div>

        {/* Optional proof. Speeds up review enormously, so it is offered right
            here rather than buried in a follow-up email. */}
        <div className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
          <p className="flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-chalk">
            <ShieldCheck className="size-4 text-volt-400" /> Attach proof (optional)
          </p>
          <p className="mt-1 text-[0.74rem] leading-relaxed text-fog">
            A business licence, a utility bill, or a photo of your signage. Stored privately, shown only to a
            reviewer, and deleted automatically after review — it never appears on your gym page.
          </p>

          <label className="tap mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-700 bg-ink-850 px-4 py-5 text-[0.78rem] font-semibold text-mist hover:border-ink-600 hover:text-chalk">
            <Upload className="size-4" />
            {proof ? "Choose a different file" : "Choose a file · JPG, PNG, WebP or PDF"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void attach(f);
              }}
            />
          </label>

          {proof && (
            <p className={`mt-2 flex items-center gap-1.5 text-[0.72rem] ${proof.state === "error" ? "text-down" : proof.state === "done" ? "text-up" : "text-mist"}`}>
              {proof.state === "uploading" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
              <span className="truncate">{proof.name}</span>
              {proof.state === "done" && <span>· attached</span>}
              {proof.state === "error" && <span>· {proof.msg}</span>}
            </p>
          )}
        </div>

        <Link href={`/gyms/${slug}`} className="text-center text-sm font-semibold text-blood-300 underline-offset-2 hover:underline">
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
