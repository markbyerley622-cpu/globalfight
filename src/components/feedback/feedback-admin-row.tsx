"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, Eye, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUSES, STATUS_LABEL } from "@/lib/feedback/shared";

// ════════════════════════════════════════════════════════════════════════════
//  One row of the operator queue, with its actions.
//
//  Every action here is a request to PATCH /api/admin/feedback/[id], which
//  calls requireAdminApi() before it reads the body. Nothing on this component
//  is load-bearing for authorisation — it is the UI for a decision the server
//  makes independently, and a non-admin who forged the same request gets a 403.
//
//  The staff note is labelled STAFF ONLY in the markup because the public note
//  sits directly above it, and a reviewer typing an internal remark into the
//  wrong box is the realistic way private text ends up on a public board.
// ════════════════════════════════════════════════════════════════════════════

export interface AdminRowItem {
  id: string;
  title: string;
  body: string;
  category: string;
  status: string;
  statusLabel: string;
  tone: "neutral" | "volt" | "gold" | "red" | "outline";
  publicNote: string | null;
  adminNote: string | null;
  hidden: boolean;
  votes: number;
  author: string | null;
  createdAt: string;
}

export function FeedbackAdminRow({ item }: { item: AdminRowItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(item.status);
  const [publicNote, setPublicNote] = useState(item.publicNote ?? "");
  const [adminNote, setAdminNote] = useState(item.adminNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That did not save.");
        return;
      }
      router.refresh();
      setOpen(false);
    } catch {
      setError("That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-ink-800 bg-ink-900 p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid w-12 shrink-0 place-items-center rounded-lg border border-ink-700 bg-ink-850 py-1.5">
          <span className="font-display text-sm font-black tabular-nums text-mist">{item.votes}</span>
          <span className="text-4xs uppercase tracking-wider text-fog">votes</span>
        </span>

        <div className="min-w-0 flex-1">
          <Link href={`/feedback/${item.id}`} className="font-display text-sm font-bold text-chalk hover:text-blood-300">
            {item.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="outline" size="sm">{item.category}</Badge>
            <Badge tone={item.tone} size="sm">{item.statusLabel}</Badge>
            {item.hidden && <Badge tone="red" size="sm">Hidden</Badge>}
            <span className="text-2xs text-fog">
              {item.author ? `@${item.author}` : "former member"} ·{" "}
              {new Date(item.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
          {item.adminNote && (
            <p className="mt-2 rounded-lg border border-gold-500/25 bg-gold-500/5 px-2.5 py-1.5 text-2xs text-gold-200">
              <span className="font-bold uppercase tracking-wider">Staff note</span> — {item.adminNote}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => send({ hidden: !item.hidden })}
            disabled={busy}
            aria-label={item.hidden ? `Restore ${item.title} to the board` : `Hide ${item.title} from the board`}
            className="tap grid size-9 place-items-center rounded-lg border border-ink-700 bg-ink-850 text-mist transition-colors hover:text-chalk disabled:opacity-50"
          >
            {item.hidden ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="tap min-h-9 rounded-lg border border-ink-700 bg-ink-850 px-3 font-display text-2xs font-bold uppercase tracking-wide text-mist transition-colors hover:text-chalk"
          >
            Manage
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 border-t border-ink-800 pt-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-mist">{item.body}</p>

          <div className="mt-3">
            <label htmlFor={`st-${item.id}`} className="block font-display text-2xs font-bold uppercase tracking-wide text-mist">
              Status
            </label>
            <select
              id={`st-${item.id}`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 text-sm text-chalk focus:outline-none focus:ring-2 focus:ring-blood-500/40"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label htmlFor={`pn-${item.id}`} className="block font-display text-2xs font-bold uppercase tracking-wide text-volt-300">
              Public note — shown on the board
            </label>
            <textarea
              id={`pn-${item.id}`}
              value={publicNote}
              onChange={(e) => setPublicNote(e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-chalk focus:outline-none focus:ring-2 focus:ring-blood-500/40"
              placeholder="Shipped in the August map release."
            />
          </div>

          <div className="mt-3">
            <label htmlFor={`an-${item.id}`} className="block font-display text-2xs font-bold uppercase tracking-wide text-gold-300">
              Staff note — never shown publicly
            </label>
            <textarea
              id={`an-${item.id}`}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-chalk focus:outline-none focus:ring-2 focus:ring-blood-500/40"
              placeholder="Duplicate of #412; keeping this one because it has the votes."
            />
          </div>

          {error && <p role="alert" className="mt-2 text-2xs text-blood-300">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ status, publicNote, adminNote })}
              className="tap inline-flex min-h-10 items-center gap-2 rounded-lg bg-blood-500 px-4 font-display text-2xs font-black uppercase tracking-wider text-white transition-colors hover:bg-blood-400 disabled:opacity-60"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="tap min-h-10 px-3 text-2xs font-bold uppercase tracking-wide text-fog hover:text-chalk"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
