"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ExternalLink, Gavel, Loader2, X } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Results review queue.
//
//  An operator has to be able to decide in SECONDS, so everything needed to judge a
//  candidate is on the row: the bout, the suggested reading, the confidence, why the
//  engine believes it, and every source headline with a link to the original.
//  Nothing is behind a click, because a queue that takes a minute per item does not
//  get worked.
//
//  Approving here WRITES the result and settles the bout. The button says so.
// ════════════════════════════════════════════════════════════════════════════

interface Evidence {
  sourceName: string;
  sourceKind: string;
  sourceUrl: string | null;
  headline: string | null;
  outcome: string;
  winnerCorner: string | null;
  method: string | null;
  roundEnded: number | null;
  quality: number;
  observedAt: string | null;
}

interface QueueItem {
  id: string;
  fightId: string;
  outcome: string;
  winnerCorner: string | null;
  method: string | null;
  roundEnded: number | null;
  confidence: number;
  status: string;
  agreeing: number;
  disagreeing: number;
  reasons: string[];
  publishedAt: string | null;
  fight: {
    id: string; slug: string; date: string; result: string;
    red: { name: string }; blue: { name: string };
    event: { name: string; slug: string } | null;
  };
  evidence: Evidence[];
}

const STATUS_TONE: Record<string, "gold" | "red" | "volt" | "neutral"> = {
  CONFLICTED: "red",
  PENDING_REVIEW: "gold",
  INCONCLUSIVE: "neutral",
  VERIFIED: "volt",
  REJECTED: "neutral",
};

export default function AdminResultsPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("CONFLICTED,PENDING_REVIEW");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/results?status=${filter}`);
      if (!res.ok) throw new Error("Could not load the queue.");
      const data = await res.json();
      setItems(data.items ?? []);
      setStats(data.stats?.counts ?? {});
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, [filter]);

  // set-state-in-effect is disabled because its premise does not hold: load() awaits
  // a fetch before it touches state, so nothing is set synchronously and there is no
  // cascading render. Fetching on mount is the point of the effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function decide(fightId: string, action: "approve" | "reject" | "inconclusive") {
    // Approving settles predictions and pays reputation — irreversible in practice,
    // so it is confirmed rather than one-click.
    if (action === "approve" && !confirm("Publish this result and settle every prediction on the bout?")) return;
    setBusy(fightId);
    setError(null);
    try {
      const res = await fetch("/api/admin/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fightId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  const reading = (i: { outcome: string; winnerCorner: string | null; method: string | null; roundEnded: number | null; fight: QueueItem["fight"] }) => {
    if (i.outcome === "DRAW") return "Draw";
    if (i.outcome === "NO_CONTEST") return "No contest";
    const who = i.winnerCorner === "RED" ? i.fight.red.name : i.fight.blue.name;
    return [who, i.method, i.roundEnded ? `R${i.roundEnded}` : null].filter(Boolean).join(" · ");
  };

  return (
    <>
      <PageHero eyebrow="Admin" title="Results review" description="Evidence-based verification. Approving publishes the result and settles the bout." />
      <div className="container-cr py-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[
            { id: "CONFLICTED,PENDING_REVIEW", label: "Needs review" },
            { id: "CONFLICTED", label: `Conflicts (${stats.CONFLICTED ?? 0})` },
            { id: "PENDING_REVIEW", label: `Pending (${stats.PENDING_REVIEW ?? 0})` },
            { id: "INCONCLUSIVE", label: `Inconclusive (${stats.INCONCLUSIVE ?? 0})` },
            { id: "VERIFIED", label: `Verified (${stats.VERIFIED ?? 0})` },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === f.id ? "border-blood-500/60 bg-blood-500/15 text-blood-200" : "border-ink-700 text-mist hover:text-chalk",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-3 text-sm text-blood-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        )}

        {items === null ? (
          <p className="flex items-center gap-2 py-16 text-mist"><Loader2 className="size-4 animate-spin" /> Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-fog">Nothing in this queue.</p>
        ) : (
          <div className="space-y-4">
            {items.map((i) => (
              <div key={i.id} className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-base font-bold text-chalk">
                      {i.fight.red.name} <span className="text-fog">vs</span> {i.fight.blue.name}
                    </p>
                    <p className="text-xs text-fog">
                      {i.fight.event?.name ?? "—"} · {new Date(i.fight.date).toLocaleDateString()}
                      {i.fight.event && (
                        <>
                          {" · "}
                          <Link href={`/events/${i.fight.event.slug}#fight-${i.fight.id}`} className="underline hover:text-mist">
                            open bout
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status.replace("_", " ")}</Badge>
                    <span className="rounded-lg border border-ink-700 px-2 py-1 text-xs tabular-nums text-mist">
                      {Math.round(i.confidence * 100)}%
                    </span>
                  </div>
                </div>

                {/* The suggested reading, stated plainly. */}
                <div className="mt-3 rounded-xl border border-ink-800 bg-ink-950/50 p-3">
                  <p className="text-[0.65rem] uppercase tracking-wider text-fog">Suggested result</p>
                  <p className="mt-0.5 font-display text-lg font-bold text-chalk">{reading(i)}</p>
                  <p className="mt-1 text-xs text-fog">
                    {i.agreeing} agreeing · {i.disagreeing} disagreeing
                  </p>
                </div>

                {/* WHY. Rendered verbatim from the engine so the operator is judging
                    the same reasoning the score came from. */}
                {i.reasons.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {i.reasons.map((r, n) => (
                      <li key={n} className={cn("text-xs", r.startsWith("CONFLICT") ? "font-semibold text-blood-300" : "text-mist")}>
                        · {r}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Sources, with the original a click away. */}
                {i.evidence.length > 0 && (
                  <div className="mt-3 divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-800">
                    {i.evidence.map((e, n) => (
                      <div key={n} className="flex items-start gap-2 px-3 py-2 text-xs">
                        <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[0.6rem] uppercase text-fog">
                          {e.sourceKind}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-mist">{e.headline ?? "—"}</span>
                          <span className="text-fog">
                            {e.sourceName} · says{" "}
                            {e.outcome === "WIN"
                              ? `${e.winnerCorner === "RED" ? i.fight.red.name : i.fight.blue.name}${e.method ? ` by ${e.method}` : ""}${e.roundEnded ? ` R${e.roundEnded}` : ""}`
                              : e.outcome}
                          </span>
                        </span>
                        {e.sourceUrl?.startsWith("http") && (
                          <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-fog hover:text-chalk" aria-label="Open source">
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!i.publishedAt && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => decide(i.fightId, "approve")} disabled={busy === i.fightId}>
                      {busy === i.fightId ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      Publish &amp; settle
                    </Button>
                    <button
                      onClick={() => decide(i.fightId, "reject")}
                      disabled={busy === i.fightId}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-xs font-semibold text-mist transition-colors hover:border-blood-500/40 hover:text-blood-300"
                    >
                      <X className="size-3.5" /> Reject
                    </button>
                    <button
                      onClick={() => decide(i.fightId, "inconclusive")}
                      disabled={busy === i.fightId}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-xs font-semibold text-mist transition-colors hover:text-chalk"
                    >
                      <Gavel className="size-3.5" /> Inconclusive
                    </button>
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
