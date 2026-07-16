"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck, BadgeCheck, Loader2, AlertCircle, Clock, X, Upload, FileCheck2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";

export function ClaimProfileButton({ slug, ownerId }: { slug: string; ownerId: string | null }) {
  const t = useT();
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const isOwner = !!user && user.id === ownerId;

  useEffect(() => {
    if (!user || ownerId) { setLoading(false); return; }
    fetch(`/api/fighters/${slug}/claim`).then((r) => r.json())
      .then((d) => setStatus(d.claim?.status ?? null))
      .finally(() => setLoading(false));
  }, [user, ownerId, slug]);

  // The voice website-builder flow was removed — claiming goes straight to ID
  // verification (the ClaimModal below).

  // Already verified to an owner.
  if (ownerId) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-up/15 px-3 py-2 font-display text-xs font-semibold uppercase tracking-wide text-up">
          <BadgeCheck className="size-4" /> {t("Verified owner")}
        </span>
        {isOwner && (
          <Link href={`/fighters/${slug}/manage`} className="rounded-lg border border-ink-700 px-3 py-2 font-display text-xs font-semibold uppercase tracking-wide text-mist hover:border-ink-600 hover:text-chalk">
            {t("Manage")}
          </Link>
        )}
      </div>
    );
  }

  if (loading) return <span className="inline-flex h-9 items-center text-xs text-fog"><Loader2 className="size-4 animate-spin" /></span>;

  if (status === "PENDING") {
    return <span className="inline-flex items-center gap-1.5 rounded-lg bg-volt-500/15 px-3 py-2 text-xs font-semibold text-volt-300"><Clock className="size-4" /> {t("Claim pending review")}</span>;
  }
  if (status === "REJECTED") {
    return <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-700/60 px-3 py-2 text-xs font-semibold text-mist">{t("Claim not approved")}</span>;
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="size-4" /> {t("Claim this profile")}
      </Button>
      {open && <ClaimModal slug={slug} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setStatus("PENDING"); }} />}
    </>
  );
}

function ClaimModal({ slug, onClose, onDone }: { slug: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const MAX = 8 * 1024 * 1024;
  // Must match the server's accepted set (src/lib/evidence/store.ts). HEIC is no
  // longer accepted — its container is a polyglot risk. The server re-checks the
  // real signature regardless of what this list allows.
  const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!ALLOWED.includes(f.type)) { setError(t("ID must be an image (JPG/PNG) or PDF.")); return; }
    if (f.size > MAX) { setError(t("File must be under 8 MB.")); return; }
    setError(null);
    setIdFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!idFile) {
      setError(t("Please upload a photo of your ID."));
      return;
    }
    setBusy(true);
    try {
      // 1) Open the claim (note + type). No URL is sent — the client never handles
      //    a storage location for the document.
      const res = await fetch(`/api/fighters/${slug}/claim`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidenceType: "id_document", evidenceNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not submit claim.");

      // 2) Upload the ID. The server stores it privately and attaches it to this
      //    user's own claim; the response contains no URL and no storage key.
      const fd = new FormData();
      fd.append("file", idFile);
      const up = await fetch(`/api/fighters/${slug}/claim/upload`, { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upData.error ?? "Could not upload your ID.");

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-ink-950/80 p-4 backdrop-blur-sm sm:items-center" onClick={submitted ? () => onDone() : onClose}>
      <div className="card-surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        {submitted ? (
          // ── Confirmation ─────────────────────────────────────────────
          <div className="flex flex-col items-center text-center">
            <button onClick={onDone} className="self-end text-fog hover:text-chalk"><X className="size-5" /></button>
            <CheckCircle2 className="mb-3 size-14 text-up" />
            <h3 className="font-display text-lg font-bold text-chalk">{t("Claim submitted")}</h3>
            <p className="mt-2 text-sm text-mist">
              {t("Thanks — we've received your ID. Our team will verify it and be in touch within 24 hours.")}
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2 text-xs font-semibold text-volt-300">
              <Clock className="size-4" /> {t("Verification typically completes within 24 hours")}
            </div>
            <Button className="mt-5 w-full" onClick={onDone}>{t("Done")}</Button>
          </div>
        ) : (
          // ── Form ─────────────────────────────────────────────────────
          <>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-chalk">{t("Claim this profile")}</h3>
              <button onClick={onClose} className="text-fog hover:text-chalk"><X className="size-5" /></button>
            </div>
            <p className="mb-4 text-sm text-mist">
              {t("To verify you're this fighter or their official representative, upload a form of ID (passport, driver's licence, or athletic-commission ID). Our team will review it and be in touch within 24 hours.")}
            </p>
            {error && <div className="mb-3 flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-2.5 text-sm text-blood-200"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div>}
            <form onSubmit={submit} className="space-y-3">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={pickFile} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={`flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-left transition-colors ${idFile ? "border-up/50 bg-up/5" : "border-ink-600 bg-ink-950/50 hover:border-blood-500/50"}`}
              >
                {idFile ? <FileCheck2 className="size-6 shrink-0 text-up" /> : <Upload className="size-6 shrink-0 text-fog" />}
                <span className="min-w-0">
                  <span className="block truncate font-display text-sm font-semibold text-chalk">{idFile ? idFile.name : t("Upload your ID")}</span>
                  <span className="block text-xs text-fog">{idFile ? t("Tap to choose a different file") : t("JPG, PNG or PDF · max 8 MB")}</span>
                </span>
              </button>
              {/* The "paste a link to your ID" field is gone on purpose: it invited
                  claimants to publish a passport on a public URL, and we then stored
                  that URL. IDs are uploaded directly and held in private storage. */}
              <textarea value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} rows={3} placeholder={t("Anything else for the reviewer (management, team, contact)…")} className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50" />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> {t("Submitting…")}</span> : t("Submit for verification")}
              </Button>
              <p className="text-center text-[0.65rem] text-fog">{t("Your ID is stored privately, used only to verify ownership, visible only to our review team, and deleted once your claim is decided.")}</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
