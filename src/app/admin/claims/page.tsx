"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Loader2, Check, X, HelpCircle, ExternalLink } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

interface Claim {
  id: string; status: string; fighterSlug: string; fighterName: string; sport: string;
  claimantName: string; claimantEmail: string | null;
  evidenceType: string | null; evidenceNote: string | null;
  // Presence + content type only — the server never sends a storage key or URL.
  hasEvidence: boolean;
  evidenceContentType: string | null;
  evidenceScanStatus: string | null;
  evidenceDeletedAt: string | null;
  reviewerName: string | null; reviewNote: string | null; createdAt: string; reviewedAt: string | null;
}

/**
 * The document is fetched from the authorized, audited streaming endpoint on our
 * own origin — the session cookie rides along automatically. There is no public
 * URL to link to, and every open is written to the audit log server-side.
 *
 * A PDF is offered as a link rather than inlined: the endpoint sends
 * `Content-Disposition: inline` under a restrictive CSP, and letting the browser
 * open it in its own tab avoids embedding a PDF viewer in our origin.
 */
function EvidencePreview({ claimId, contentIsPdf }: { claimId: string; contentIsPdf: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/claims/${claimId}/evidence`;

  if (contentIsPdf) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs font-semibold text-mist hover:text-chalk">
        Open PDF document ↗
      </a>
    );
  }
  if (failed) {
    return (
      <p className="mt-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-fog">
        Document unavailable — it may have been deleted under the retention policy. Ask the claimant to re-submit.
      </p>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="mt-2 block w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Submitted ID document" onError={() => setFailed(true)} className="max-h-56 rounded-lg border border-ink-700 object-contain" />
    </a>
  );
}

/**
 * Malware-scan state, shown to the reviewer before they open anything.
 *
 * SKIPPED must NEVER read as CLEAN. A structurally valid file is not a scanned
 * file, and a reviewer about to open a stranger's PDF is entitled to know which of
 * the two they are looking at. INFECTED documents are deleted and never served, so
 * they cannot appear here with a preview.
 */
function ScanBadge({ status }: { status: string | null }) {
  if (status === "CLEAN") {
    return <p className="mt-2 text-[0.7rem] font-semibold text-up">✓ Scanned — no malware detected</p>;
  }
  if (status === "PENDING") {
    return <p className="mt-2 text-[0.7rem] font-semibold text-gold">⏳ Scan in progress — do not open yet</p>;
  }
  // SKIPPED (no scanner configured) or null (legacy/migrated) — be explicit.
  return (
    <p className="mt-2 text-[0.7rem] font-semibold text-gold">
      ⚠ NOT scanned for malware (no scanner configured) — open with care
    </p>
  );
}

const TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "INFO_REQUESTED", label: "Info requested" },
];

export default function AdminClaimsPage() {
  const t = useT();
  const [tab, setTab] = useState("PENDING");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/claims?status=${tab}`, { cache: "no-store" });
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    const data = await res.json();
    setClaims(data.claims ?? []);
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "approve" | "reject" | "info") {
    const note = action !== "approve" ? (prompt(action === "info" ? "What info is needed?" : "Reason (optional):") ?? "") : "";
    setBusyId(id);
    const res = await fetch(`/api/admin/claims/${id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    setBusyId(null);
    if (!res.ok) { const d = await res.json(); alert(d.error ?? "Failed."); return; }
    load();
  }

  if (forbidden) {
    return (
      <>
        <PageHero eyebrow="Admin" title="Claims" />
        <div className="container-cr py-16 text-center">
          <ShieldCheck className="mx-auto mb-3 size-10 text-ink-600" />
          <p className="font-display text-lg font-bold text-chalk">{t("Admins only")}</p>
          <p className="mt-1 text-sm text-fog">You need a moderator or admin role to review claims.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero eyebrow="Admin" title="Profile Claims" description="Review fighter profile-ownership claims. Approving assigns ownership and writes an audit log." />
      <div className="container-cr py-10">
        <div className="mb-5 flex flex-wrap gap-2">
          {TABS.map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`rounded-lg border px-3.5 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors ${tab === tb.key ? "border-blood-500/50 bg-blood-500/15 text-blood-200" : "border-ink-700 bg-ink-850/60 text-mist hover:text-chalk"}`}>
              {t(tb.label)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-card bg-ink-850/60" />)}</div>
        ) : claims.length === 0 ? (
          <div className="card-surface p-10 text-center text-sm text-fog">No {tab.toLowerCase().replace("_", " ")} claims.</div>
        ) : (
          <div className="space-y-3">
            {claims.map((c) => (
              <div key={c.id} className="card-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/fighters/${c.fighterSlug}`} className="flex items-center gap-2 font-display font-bold text-chalk hover:text-blood-300">
                      {c.fighterName} <ExternalLink className="size-3.5 text-fog" />
                    </Link>
                    <p className="mt-0.5 text-xs text-fog">Claimant: {c.claimantName} ({c.claimantEmail}) · {new Date(c.createdAt).toLocaleDateString()}</p>
                    <p className="mt-2 text-sm text-mist">
                      <span className="text-fog">Evidence ({c.evidenceType ?? "—"}):</span>{" "}
                      {c.hasEvidence
                        ? <a href={`/api/claims/${c.id}/evidence`} target="_blank" rel="noopener noreferrer" className="text-blood-400 hover:text-blood-300">Open document ↗</a>
                        : c.evidenceDeletedAt
                          ? <span className="text-fog">deleted under retention policy</span>
                          : "—"}
                    </p>
                    {c.hasEvidence && <ScanBadge status={c.evidenceScanStatus} />}
                    {c.hasEvidence && (
                      <EvidencePreview claimId={c.id} contentIsPdf={c.evidenceContentType === "application/pdf"} />
                    )}
                    {c.evidenceNote && <p className="mt-2 text-sm text-mist">{c.evidenceNote}</p>}
                    {c.reviewNote && <p className="mt-1 text-xs text-fog">Review note: {c.reviewNote}{c.reviewerName ? ` — ${c.reviewerName}` : ""}</p>}
                  </div>
                  <Badge tone={c.status === "APPROVED" ? "volt" : c.status === "REJECTED" ? "neutral" : "gold"}>{c.status}</Badge>
                </div>
                {(c.status === "PENDING" || c.status === "INFO_REQUESTED") && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => act(c.id, "approve")} disabled={busyId === c.id}>
                      {busyId === c.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {t("Approve")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => act(c.id, "reject")} disabled={busyId === c.id}><X className="size-4" /> {t("Reject")}</Button>
                    <Button size="sm" variant="outline" onClick={() => act(c.id, "info")} disabled={busyId === c.id}><HelpCircle className="size-4" /> {t("Request info")}</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
