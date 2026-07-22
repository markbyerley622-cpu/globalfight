"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Check, X, MessageSquare, BadgeCheck, FileText, Copy, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface Claim {
  id: string;
  status: string;
  evidence: string | null;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  evidenceUploadedAt: string | null;
  evidenceScanStatus: string | null;
  evidenceContentType: string | null;
  evidenceByteSize: number | null;
  gym: { id: string; slug: string; name: string; city: string | null; country: string | null; ownerId: string | null };
  claimant: { id: string; name: string | null; username: string | null; email: string | null };
}

const TABS = ["pending", "approved", "rejected", "all"] as const;

/** Gym ownership review queue. Approving is what grants control of a gym page —
 *  nothing else in the app sets Gym.ownerId. */
export default function GymClaimsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("pending");
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setClaims(null);
    try {
      const res = await fetch(`/api/admin/gym-claims?status=${tab}`);
      if (!res.ok) throw new Error("Forbidden or unavailable.");
      const d = await res.json();
      setClaims(d.claims ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load claims.");
      setClaims([]);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "approve" | "reject" | "info") {
    const note = action === "approve" ? "" : (prompt(action === "info" ? "What do you need from them?" : "Reason (optional):") ?? "");
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/gym-claims/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: note || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container-cr py-8">
      <h1 className="font-display text-2xl font-black uppercase tracking-tight text-chalk">Gym claims</h1>
      <p className="mt-1 text-sm text-fog">
        Approving sets the gym&apos;s owner, marks it verified and rejects competing claims.
      </p>

      <div className="mt-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 font-display text-[0.7rem] font-bold uppercase tracking-wide transition-colors",
              tab === t
                ? "border-chalk bg-chalk text-ink-950"
                : "border-ink-700 bg-ink-850 text-mist hover:text-chalk",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 rounded-xl border border-down/40 bg-down/10 px-3.5 py-3 text-sm text-down">{error}</p>}

      {claims === null ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-fog"><Loader2 className="size-4 animate-spin" /> Loading…</p>
      ) : claims.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-fog">
          Nothing {tab === "all" ? "here" : tab}.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3">
          {claims.map((c) => (
            <li key={c.id} className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/gyms/${c.gym.slug}`} className="flex items-center gap-1.5 font-display text-base font-bold text-chalk hover:underline">
                    {c.gym.name}
                    {c.gym.ownerId && <BadgeCheck className="size-4 text-volt-400" />}
                  </Link>
                  <p className="mt-0.5 text-[0.75rem] text-fog">
                    {[c.gym.city, c.gym.country].filter(Boolean).join(", ") || "Location unknown"}
                  </p>
                  <p className="mt-1.5 text-[0.78rem] text-mist">
                    Claimed by{" "}
                    <span className="font-semibold text-chalk">
                      {c.claimant.name ?? c.claimant.username ?? "unknown"}
                    </span>
                    {c.claimant.email && <span className="text-fog"> · {c.claimant.email}</span>}
                  </p>
                </div>
                <span className={cn(
                  "shrink-0 rounded-md px-2 py-1 font-display text-[0.62rem] font-bold uppercase tracking-wider",
                  c.status === "approved" ? "bg-up/15 text-up"
                    : c.status === "rejected" ? "bg-down/15 text-down"
                    : "bg-gold-500/15 text-gold-300",
                )}>
                  {c.status.replace("_", " ")}
                </span>
              </div>

              {/* Claim ID — reviewers quote this in correspondence and in the
                  audit trail, so it has to be visible and copyable. */}
              <div className="mt-2.5 flex items-center gap-2">
                <code className="rounded border border-ink-800 bg-ink-950/70 px-2 py-1 font-mono text-[0.68rem] text-fog">
                  {c.id}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(c.id)}
                  aria-label="Copy claim ID"
                  className="tap grid size-6 place-items-center rounded border border-ink-700 text-fog hover:text-chalk"
                >
                  <Copy className="size-3" />
                </button>
              </div>

              {c.evidence && (
                <p className="mt-3 whitespace-pre-wrap rounded-xl border border-ink-800 bg-ink-950/60 p-3 text-[0.8rem] leading-relaxed text-mist">
                  {c.evidence}
                </p>
              )}

              {/* Uploaded proof. Streamed through the private reader — there is
                  no public URL for these bytes. */}
              {c.evidenceUploadedAt ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-ink-800 bg-ink-950/60 p-3">
                  <FileText className="size-4 shrink-0 text-volt-400" />
                  <span className="text-[0.76rem] text-mist">
                    Proof attached
                    {c.evidenceByteSize ? ` · ${Math.round(c.evidenceByteSize / 1024)} KB` : ""}
                    {c.evidenceContentType ? ` · ${c.evidenceContentType.split("/")[1]?.toUpperCase()}` : ""}
                  </span>
                  {c.evidenceScanStatus && c.evidenceScanStatus !== "CLEAN" && c.evidenceScanStatus !== "SKIPPED" ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-gold-500/15 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-wider text-gold-300">
                      <ShieldAlert className="size-3" /> {c.evidenceScanStatus}
                    </span>
                  ) : (
                    <a
                      href={`/api/admin/gym-claims/${c.id}/evidence`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap ml-auto rounded-lg border border-volt-500/40 bg-volt-500/10 px-2.5 py-1.5 font-display text-[0.66rem] font-bold uppercase tracking-wide text-volt-400"
                    >
                      View document
                    </a>
                  )}
                </div>
              ) : (
                <p className="mt-2.5 rounded-xl border border-dashed border-ink-800 px-3 py-2 text-[0.72rem] text-fog">
                  No document attached — text evidence only.
                </p>
              )}
              {c.note && <p className="mt-2 text-[0.72rem] text-fog">Note: {c.note}</p>}

              {(c.status === "pending" || c.status === "info_requested") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Action onClick={() => act(c.id, "approve")} busy={busy === c.id} tone="up" icon={<Check className="size-3.5" />}>Approve</Action>
                  <Action onClick={() => act(c.id, "info")} busy={busy === c.id} icon={<MessageSquare className="size-3.5" />}>Need info</Action>
                  <Action onClick={() => act(c.id, "reject")} busy={busy === c.id} tone="down" icon={<X className="size-3.5" />}>Reject</Action>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Action({
  onClick, busy, tone, icon, children,
}: { onClick: () => void; busy: boolean; tone?: "up" | "down"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "tap inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-display text-[0.7rem] font-bold uppercase tracking-wide transition-colors disabled:opacity-60",
        tone === "up" ? "border-up/40 bg-up/12 text-up"
          : tone === "down" ? "border-down/40 bg-down/12 text-down"
          : "border-ink-700 bg-ink-850 text-mist hover:text-chalk",
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}
