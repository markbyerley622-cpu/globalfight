"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, Check, HelpCircle, Loader2, X, AlertTriangle } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { timeAgo, cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  ONE APPLICATION, DECIDED IN UNDER A MINUTE.
//
//  Everything a reviewer needs is on the card — the evidence the applicant
//  gave, how old the account is, whether the organisation already has events
//  attached — so the decision never requires opening another tab.
//
//  RISK FLAGS are computed and shown rather than left for the reviewer to
//  notice. A day-old account claiming a promotion that already has 40 scraped
//  events is a different proposition from an established account claiming an
//  empty one, and a reviewer working through a queue will not re-derive that
//  every time.
//
//  Optimistic and in place: a decided card resolves where it sits instead of
//  reloading the queue, so a reviewer keeps their position in the list.
// ════════════════════════════════════════════════════════════════════════════

export interface ClaimRow {
  id: string;
  status: string;
  note: string | null;
  createdAt: string;
  user: { id: string; username: string | null; name: string; image: string | null; accountAgeDays: number };
  org: { id: string; name: string; slug: string; verified: boolean; claimed: boolean; eventCount: number };
}

export function PromoterClaimReview({ claims }: { claims: ClaimRow[] }) {
  const [rows, setRows] = useState(claims);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-ink-800 bg-ink-900/40 px-4 py-10 text-center text-sm text-fog">
        Nothing waiting. The queue is clear.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((c) => (
        <li key={c.id}>
          <ClaimCard claim={c} onDone={() => setRows((rs) => rs.filter((r) => r.id !== c.id))} />
        </li>
      ))}
    </ul>
  );
}

function ClaimCard({ claim, onDone }: { claim: ClaimRow; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected" | "info_requested") {
    if (decision !== "approved" && !reason.trim()) {
      setError("Give a reason — the applicant sees it.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/admin/promoter-claims/${claim.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Couldn't record that.");
      }
      onDone();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record that.");
    } finally {
      setBusy(null);
    }
  }

  // Computed, not left to the reviewer to spot.
  const risks: string[] = [];
  if (claim.user.accountAgeDays < 7) risks.push(`Account is ${claim.user.accountAgeDays}d old`);
  if (claim.org.eventCount > 0) risks.push(`Org already has ${claim.org.eventCount} event${claim.org.eventCount === 1 ? "" : "s"}`);
  if (claim.org.claimed) risks.push("Org already has an owner");
  if (!claim.note?.trim()) risks.push("No evidence given");

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/50 p-4">
      <div className="flex items-start gap-3">
        <ForumAvatar name={claim.user.name} image={claim.user.image} size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-chalk">
            {claim.user.username ? (
              <Link href={`/u/${claim.user.username}`} className="hover:underline">{claim.user.name}</Link>
            ) : claim.user.name}
            <span className="ml-1.5 font-sans text-xs font-normal text-fog">
              wants {claim.org.name}
            </span>
          </p>
          <p className="text-xs text-fog">
            Applied {timeAgo(claim.createdAt)}
            {claim.status === "info_requested" && " · more info requested"}
          </p>
        </div>
        {claim.org.verified && <BadgeCheck className="size-5 shrink-0 text-volt-400" aria-hidden />}
      </div>

      {risks.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {risks.map((r) => (
            <li
              key={r}
              className="inline-flex items-center gap-1 rounded-full border border-volt-500/40 bg-volt-500/10 px-2 py-0.5 text-3xs font-bold uppercase tracking-wider text-volt-200"
            >
              <AlertTriangle className="size-3" aria-hidden /> {r}
            </li>
          ))}
        </ul>
      )}

      {claim.note?.trim() && (
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-ink-800 bg-ink-950/60 p-3 font-sans text-xs leading-relaxed text-mist">
          {claim.note}
        </pre>
      )}

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Reason — required to decline or ask for more. The applicant reads this."
        className="mt-3 w-full rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-2 text-xs text-chalk outline-none placeholder:text-ink-600 focus:border-blood-500/60"
      />

      {error && (
        <p role="alert" className="mt-2 text-xs text-blood-300">{error}</p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Decide
          onClick={() => void decide("approved")}
          busy={busy === "approved"}
          disabled={busy !== null}
          tone="approve"
          icon={<Check className="size-4" aria-hidden />}
          label="Approve"
        />
        <Decide
          onClick={() => void decide("info_requested")}
          busy={busy === "info_requested"}
          disabled={busy !== null}
          tone="neutral"
          icon={<HelpCircle className="size-4" aria-hidden />}
          label="Ask for more"
        />
        <Decide
          onClick={() => void decide("rejected")}
          busy={busy === "rejected"}
          disabled={busy !== null}
          tone="reject"
          icon={<X className="size-4" aria-hidden />}
          label="Decline"
        />
      </div>
    </div>
  );
}

function Decide({
  onClick, busy, disabled, tone, icon, label,
}: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  tone: "approve" | "reject" | "neutral";
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "tap inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50",
        tone === "approve" && "border-volt-500/50 bg-volt-500/15 text-volt-200 hover:bg-volt-500/25",
        tone === "reject" && "border-blood-500/50 bg-blood-500/10 text-blood-200 hover:bg-blood-500/20",
        tone === "neutral" && "border-ink-700 text-mist hover:border-ink-600",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}
