"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2, Upload, Clock } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";

interface Doc { id: string; kind: string; contentType: string; deletedAt: string | null }
interface Row {
  id: string; status: string; role: string; attempt: number;
  submittedAt: string; reviewedAt: string | null; declineReason: string | null;
  documents: Doc[];
}

const TONE: Record<string, "gold" | "volt" | "red" | "neutral"> = {
  PENDING: "gold", APPROVED: "volt", DECLINED: "red", RESUBMIT_REQUESTED: "neutral",
};
const MAX_MB = 8;

/**
 * Professional identity verification, from the user's side.
 *
 * This is a DESTINATION, not a step in signup. Someone arrives here from the
 * banner on their account after they already have a working account, which is
 * the entire point: the review queue is asynchronous and human, and putting it
 * in front of registration would mean abandoning every signup that lands while
 * the queue is asleep.
 */
export default function VerificationPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const res = await fetch("/api/verification/identity");
      if (res.status === 401) { setFetching(false); return; }
      const data = await res.json();
      setRows(data.history ?? []);
      setAllowed(Boolean(data.canSubmit));
      setBlockedReason(data.reason ?? null);
    } catch {
      setError("Could not load your verification status.");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    const front = form.get("front");
    if (!(front instanceof File) || front.size === 0) {
      setError("The front of your ID is required.");
      return;
    }
    // Client-side size check is a courtesy that saves an 8MB upload before the
    // server rejects it. The server enforces the same limit regardless.
    for (const key of ["front", "back", "supporting"]) {
      const f = form.get(key);
      if (f instanceof File && f.size > MAX_MB * 1024 * 1024) {
        setError(`${key} must be under ${MAX_MB}MB.`);
        return;
      }
    }

    setBusy(true);
    try {
      const res = await fetch("/api/verification/identity", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not submit your documents.");
      formRef.current?.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your documents.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || fetching) {
    return <div className="flex justify-center py-20 text-fog"><Loader2 className="size-6 animate-spin" /></div>;
  }

  if (!user) {
    return (
      <>
        <PageHero eyebrow="Account" title="Verify your identity" />
        <div className="mx-auto max-w-md px-4 pb-16 pt-6">
          <div className="card-surface p-6 text-center text-sm text-mist">Sign in to verify your identity.</div>
        </div>
      </>
    );
  }

  const verified = rows.some((r) => r.status === "APPROVED");

  return (
    <>
      <PageHero
        eyebrow="Account"
        title="Verify your identity"
        description="Confirm who you are to receive your verified badge and unlock professional features. Your account already works — this is optional and only affects the badge."
      />

      <div className="mx-auto max-w-xl px-4 pb-16 pt-6">
        {verified && (
          <div className="mb-4 flex items-center gap-3 rounded-card border border-volt-500/30 bg-volt-500/10 p-4">
            <CheckCircle2 className="size-5 shrink-0 text-volt-400" />
            <p className="text-sm text-volt-400">Your professional identity is verified.</p>
          </div>
        )}

        {allowed ? (
          <form ref={formRef} onSubmit={submit} className="card-surface p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-chalk">
              <ShieldCheck className="size-4 text-blood-400" /> Upload your ID
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-fog">
              A passport, driving licence or government ID. Images only (JPEG, PNG or WebP), up to {MAX_MB}MB each.
              Location data is stripped before storage, documents are kept private, and they are deleted 30 days
              after a decision.
            </p>

            <FileField name="front" label="Front of ID" required />
            <FileField name="back" label="Back of ID" hint="Not needed for a passport photo page" />
            <FileField name="supporting" label="Supporting document" hint="Optional — a licence, contract or accreditation" />

            {error && (
              <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-xs text-down">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}

            <Button type="submit" disabled={busy} size="md" className="mt-4 w-full">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {busy ? "Uploading…" : "Submit for review"}
            </Button>
          </form>
        ) : (
          blockedReason && (
            <div className="card-surface flex items-center gap-3 p-5">
              <Clock className="size-5 shrink-0 text-fog" />
              <p className="text-sm text-mist">{blockedReason}</p>
            </div>
          )
        )}

        {rows.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 font-display text-2xs font-bold uppercase tracking-wide text-fog">Your submissions</h2>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.id} className="rounded-card border border-ink-800 bg-ink-900 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[r.status] ?? "neutral"} size="sm">
                      {r.status === "RESUBMIT_REQUESTED" ? "More info needed" : r.status}
                    </Badge>
                    <span className="text-2xs text-fog">
                      Attempt {r.attempt} · {new Date(r.submittedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {r.declineReason && <p className="mt-2 text-xs leading-relaxed text-mist">{r.declineReason}</p>}
                  <p className="mt-1.5 text-3xs text-fog">
                    {r.documents.length} document{r.documents.length === 1 ? "" : "s"}
                    {r.documents.every((d) => d.deletedAt) && r.documents.length > 0 && " · deleted under retention policy"}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function FileField({ name, label, hint, required }: { name: string; label: string; hint?: string; required?: boolean }) {
  return (
    <div className="mt-4">
      <label htmlFor={name} className="block font-display text-2xs font-bold uppercase tracking-wide text-mist">
        {label} {!required && <span className="font-normal text-fog">· optional</span>}
      </label>
      {hint && <p className="mt-0.5 text-3xs text-fog">{hint}</p>}
      <input
        id={name}
        name={name}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required={required}
        className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950/50 p-2.5 text-xs text-mist file:mr-3 file:rounded-md file:border-0 file:bg-ink-800 file:px-3 file:py-1.5 file:font-display file:text-2xs file:font-bold file:uppercase file:tracking-wide file:text-chalk hover:file:bg-ink-700"
      />
    </div>
  );
}
