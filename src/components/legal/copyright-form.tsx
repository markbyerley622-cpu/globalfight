"use client";

import { useState } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const field =
  "w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50";

/**
 * Copyright / takedown notice.
 *
 * Deliberately usable WITHOUT an account: a rights owner is almost always a stranger
 * to the platform. Requiring a sign-up would make the takedown path useless in
 * practice, which is the opposite of what it is for.
 */
export function CopyrightNoticeForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);
    const payload = {
      contentIdentifier: String(form.get("contentIdentifier") ?? ""),
      contentUrl: String(form.get("contentUrl") ?? ""),
      reporterName: String(form.get("reporterName") ?? ""),
      reporterEmail: String(form.get("reporterEmail") ?? ""),
      reporterOrg: String(form.get("reporterOrg") ?? ""),
      workDescription: String(form.get("workDescription") ?? ""),
      ownershipClaim: form.get("ownershipClaim") === "on",
      goodFaithClaim: form.get("goodFaithClaim") === "on",
      signature: String(form.get("signature") ?? ""),
    };

    try {
      const res = await fetch("/api/copyright", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not submit the notice.");
      setReference(data.reference as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-up/40 bg-up/10 p-3 text-sm text-chalk">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" />
        <span>
          Notice received. Your reference is <b className="font-mono">{reference}</b>. We will review
          it and be in touch by email.
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-2.5 text-sm text-blood-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <label className="block text-xs text-fog">
        What content? (page URL, or a clip / post identifier) *
        <input name="contentIdentifier" required className={`${field} mt-1`} placeholder="e.g. /fighters/some-fighter, or clip:abc123" />
      </label>

      <label className="block text-xs text-fog">
        Direct link to it (optional)
        <input name="contentUrl" className={`${field} mt-1`} placeholder="https://…" />
      </label>

      <label className="block text-xs text-fog">
        What work of yours does it infringe? *
        <textarea name="workDescription" required rows={3} className={`${field} mt-1`} placeholder="Describe the photograph, video, article or other work, and where it was originally published." />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-fog">
          Your name *
          <input name="reporterName" required className={`${field} mt-1`} />
        </label>
        <label className="block text-xs text-fog">
          Your email *
          <input name="reporterEmail" type="email" required className={`${field} mt-1`} />
        </label>
      </div>

      <label className="block text-xs text-fog">
        Company / rights holder you act for (optional)
        <input name="reporterOrg" className={`${field} mt-1`} />
      </label>

      <label className="flex items-start gap-2 text-xs text-mist">
        <input type="checkbox" name="ownershipClaim" required className="mt-0.5" />
        <span>I am the owner of the rights in this work, or I am authorised to act on the owner&apos;s behalf. *</span>
      </label>

      <label className="flex items-start gap-2 text-xs text-mist">
        <input type="checkbox" name="goodFaithClaim" required className="mt-0.5" />
        <span>I believe in good faith that the use complained of is not authorised by the rights owner, its agent, or the law. *</span>
      </label>

      <label className="block text-xs text-fog">
        Electronic signature — type your full name *
        <input name="signature" required className={`${field} mt-1`} placeholder="Your full legal name" />
      </label>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy
          ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Submitting…</span>
          : "Submit copyright notice"}
      </Button>
      <p className="text-center text-[0.65rem] text-fog">
        Knowingly submitting a false notice may make you liable for damages.
      </p>
    </form>
  );
}
