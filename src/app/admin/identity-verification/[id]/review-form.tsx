"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, HelpCircle, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Decision = "APPROVE" | "DECLINE" | "REQUEST_RESUBMIT";

/**
 * The three decisions, plus the two text fields.
 *
 * `reason` is shown to the user and `note` never is — they are deliberately two
 * inputs rather than one, because a reviewer writing "obvious fake, previous
 * attempt from same IP" into a single box that later gets emailed is exactly the
 * accident this separation prevents. The labels say which is which.
 */
export function ReviewForm({ id, decided }: { id: string; decided: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    if (decision !== "APPROVE" && !reason.trim()) {
      setError("A reason is required — the user sees it.");
      return;
    }
    setError(null);
    setBusy(decision);
    try {
      const res = await fetch(`/api/admin/identity-verification/${id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not record that decision.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that decision.");
    } finally {
      setBusy(null);
    }
  }

  if (decided) {
    return (
      <p className="rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-3 text-xs text-fog">
        This request has been decided. Decisions are permanent — if the user needs another
        chance, they submit a new request from their account.
      </p>
    );
  }

  return (
    <div>
      <label htmlFor="reason" className="block font-display text-2xs font-bold uppercase tracking-wide text-mist">
        Reason <span className="font-normal text-fog">— the user reads this</span>
      </label>
      <textarea
        id="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="e.g. The back of the ID is too blurred to read the expiry date."
        className="mt-1.5 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
      />

      <label htmlFor="note" className="mt-4 block font-display text-2xs font-bold uppercase tracking-wide text-mist">
        Internal note <span className="font-normal text-fog">— staff only, never shown or emailed</span>
      </label>
      <textarea
        id="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="mt-1.5 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/50 p-3 text-sm text-chalk outline-none focus:border-blood-500/50"
      />

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-xs text-down">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => decide("APPROVE")} disabled={busy !== null} size="sm">
          {busy === "APPROVE" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Approve
        </Button>
        <Button onClick={() => decide("REQUEST_RESUBMIT")} disabled={busy !== null} variant="outline" size="sm">
          {busy === "REQUEST_RESUBMIT" ? <Loader2 className="size-3.5 animate-spin" /> : <HelpCircle className="size-3.5" />}
          Request resubmission
        </Button>
        <Button onClick={() => decide("DECLINE")} disabled={busy !== null} variant="ghost" size="sm" className="text-blood-300 hover:bg-blood-500/10 hover:text-blood-200">
          {busy === "DECLINE" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          Decline
        </Button>
      </div>
    </div>
  );
}
