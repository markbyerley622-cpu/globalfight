"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDown, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { Row, Text, Select, DateTime, Toggle } from "@/components/admin/fields";
import { FighterPicker } from "@/components/admin/fighter-picker";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  The fight card.
//
//  Ordering is a SET operation: dragging one bout changes the index of every
//  bout after it, so the UI holds the whole order and PATCHes the whole order.
//  Main event and co-main are DERIVED from position (top two of MAIN), so an
//  operator never hand-numbers anything and the badges cannot contradict the
//  running order.
//
//  Drag is native HTML5 — no dependency for a list of at most ~20 rows — and
//  every drag has a keyboard equivalent, because a reorder-only-by-mouse tool is
//  unusable for anyone who cannot use one.
// ════════════════════════════════════════════════════════════════════════════

export type Segment = "MAIN" | "PRELIM" | "EARLY_PRELIM";

const SEGMENT_LABEL: Record<Segment, string> = {
  MAIN: "Main card", PRELIM: "Prelims", EARLY_PRELIM: "Early prelims",
};
const SEGMENT_ORDER: Segment[] = ["MAIN", "PRELIM", "EARLY_PRELIM"];

export interface EditableFight {
  id: string; updatedAt: string; lockedFields: string[];
  redId: string; redName: string; blueId: string; blueName: string;
  weightClassId: string | null; scheduledRounds: number;
  titleFight: boolean; interimTitle: boolean; mainEvent: boolean; coMain: boolean;
  cardSegment: Segment; cancelled: boolean; cardNote: string | null;
  estimatedStartAt: string | null;
  result: string; winnerId: string | null; method: string | null;
  roundEnded: number | null; timeEnded: string | null;
  performanceBonus: boolean; fightOfTheNight: boolean;
}

export interface WeightClassOption { id: string; name: string }

const METHODS = ["", "KO", "TKO", "SUB", "UD", "SD", "MD", "DQ", "RTD", "TD", "NC", "DRAW"]
  .map((v) => ({ value: v, label: v || "—" }));
const RESULTS = ["SCHEDULED", "WIN", "DRAW", "NO_CONTEST"].map((v) => ({ value: v, label: v.replace("_", " ") }));

export function FightCardEditor({ eventId, initial, weightClasses }: {
  eventId: string; initial: EditableFight[]; weightClasses: WeightClassOption[];
}) {
  const [fights, setFights] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const dragId = useRef<string | null>(null);

  /** Persist the whole order. Called after any move, mouse or keyboard. */
  const persistOrder = useCallback(async (next: EditableFight[]) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/fights`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: next.map((f) => ({ id: f.id, segment: f.cardSegment })) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.issues?.[0]?.message ?? "Could not save the order.");
        return false;
      }
      return true;
    } catch { setError("Could not save the order."); return false; }
    finally { setBusy(false); }
  }, [eventId]);

  /** Move a bout to an absolute index, optionally changing segment. Optimistic:
   *  the list reorders instantly and reverts if the write fails. */
  const move = useCallback(async (id: string, toIndex: number, segment?: Segment) => {
    const before = fights;
    const from = fights.findIndex((f) => f.id === id);
    if (from < 0) return;
    const next = [...fights];
    const [row] = next.splice(from, 1);
    const moved = segment ? { ...row, cardSegment: segment } : row;
    next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved);

    // Derive the badges from position so they can never disagree with the order.
    const mains = next.filter((f) => f.cardSegment === "MAIN");
    const withBadges = next.map((f) => ({
      ...f,
      mainEvent: mains[0]?.id === f.id,
      coMain: mains[1]?.id === f.id,
    }));
    setFights(withBadges);
    if (!(await persistOrder(withBadges))) setFights(before);
  }, [fights, persistOrder]);

  function patchLocal(id: string, patch: Partial<EditableFight>) {
    setFights((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async function addFight(redId: string, blueId: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/fights`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ redId, blueId }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.issues?.[0]?.message ?? "Could not add the bout."); return; }
      setAdding(false);
      window.location.reload(); // the new row needs its server-rendered shape
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this bout from the card?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/fights/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        if (d.detached) { patchLocal(id, { cancelled: true, cardNote: "Removed from card." }); }
        else setFights((prev) => prev.filter((f) => f.id !== id));
      }
    } finally { setBusy(false); }
  }

  const grouped = SEGMENT_ORDER.map((seg) => ({ seg, rows: fights.filter((f) => f.cardSegment === seg) }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-mist">Fight card</h2>
        <span className="text-[0.7rem] text-fog">{fights.length} bouts</span>
        {busy && <Loader2 className="size-3 animate-spin text-fog" />}
        {error && <span className="text-[0.7rem] text-blood-300">{error}</span>}
        <button
          onClick={() => setAdding((a) => !a)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[0.7rem] font-semibold text-fog hover:text-chalk"
        >
          <Plus className="size-3" /> Add bout
        </button>
      </div>

      {adding && <FighterPicker onPick={addFight} onCancel={() => setAdding(false)} />}

      {grouped.map(({ seg, rows }) => (
        <section key={seg}>
          <div
            className="mb-1 flex items-center gap-2 rounded border border-dashed border-ink-800 px-2 py-1"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragId.current;
              if (!id) return;
              // Dropping on a segment header moves the bout to the END of it.
              const lastIndexOfSeg = fights.reduce((acc, f, i) => (f.cardSegment === seg ? i : acc), -1);
              void move(id, lastIndexOfSeg < 0 ? fights.length : lastIndexOfSeg + 1, seg);
              dragId.current = null;
            }}
          >
            <span className="text-[0.65rem] font-bold uppercase tracking-wider text-fog">{SEGMENT_LABEL[seg]}</span>
            <span className="text-[0.65rem] text-ink-600">{rows.length}</span>
          </div>

          <div className="space-y-1">
            {rows.map((f) => {
              const globalIndex = fights.findIndex((x) => x.id === f.id);
              return (
                <FightRowEditor
                  key={f.id}
                  fight={f}
                  weightClasses={weightClasses}
                  open={openId === f.id}
                  onToggle={() => setOpenId(openId === f.id ? null : f.id)}
                  onDragStart={() => { dragId.current = f.id; }}
                  onDropOn={() => {
                    const id = dragId.current;
                    if (!id || id === f.id) return;
                    void move(id, globalIndex, f.cardSegment);
                    dragId.current = null;
                  }}
                  onMoveUp={() => globalIndex > 0 && void move(f.id, globalIndex - 1, fights[globalIndex - 1].cardSegment)}
                  onMoveDown={() => globalIndex < fights.length - 1 && void move(f.id, globalIndex + 1, fights[globalIndex + 1].cardSegment)}
                  onSegment={(s) => void move(f.id, globalIndex, s)}
                  onLocalPatch={(p) => patchLocal(f.id, p)}
                  onRemove={() => remove(f.id)}
                />
              );
            })}
            {rows.length === 0 && (
              <p className="px-2 py-2 text-[0.7rem] text-ink-600">Empty — drag a bout here.</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function FightRowEditor({
  fight, weightClasses, open, onToggle, onDragStart, onDropOn, onMoveUp, onMoveDown, onSegment, onLocalPatch, onRemove,
}: {
  fight: EditableFight; weightClasses: WeightClassOption[]; open: boolean;
  onToggle: () => void; onDragStart: () => void; onDropOn: () => void;
  onMoveUp: () => void; onMoveDown: () => void; onSegment: (s: Segment) => void;
  onLocalPatch: (p: Partial<EditableFight>) => void; onRemove: () => void;
}) {
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const updatedAt = useRef(fight.updatedAt);

  /** Per-field save. Same write path, validation and audit as the event editor. */
  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/fights/${fight.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch, expectedUpdatedAt: updatedAt.current }),
      });
      const d = await res.json();
      if (res.status === 422) {
        setIssues(Object.fromEntries((d.issues ?? []).map((i: { field: string; message: string }) => [i.field, i.message])));
        return;
      }
      if (res.status === 409) { setIssues({ _: "Someone else changed this bout. Reload." }); return; }
      if (d.fight) { updatedAt.current = d.fight.updatedAt; setIssues({}); }
    } finally { setSaving(false); }
  }

  function set<K extends keyof EditableFight>(key: K, value: EditableFight[K]) {
    onLocalPatch({ [key]: value } as Partial<EditableFight>);
    void save({ [key]: value });
  }

  const decided = fight.result !== "SCHEDULED";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDropOn(); }}
      className={cn(
        "rounded-md border bg-ink-900/40 transition-colors",
        fight.cancelled ? "border-ink-800 opacity-60" : "border-ink-800 hover:border-ink-700",
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <GripVertical className="size-3.5 shrink-0 cursor-grab text-ink-600" aria-hidden />
        <div className="flex shrink-0 flex-col">
          <button onClick={onMoveUp} aria-label="Move up" className="tap px-0.5 text-[0.6rem] leading-none text-ink-600 hover:text-chalk">▲</button>
          <button onClick={onMoveDown} aria-label="Move down" className="tap px-0.5 text-[0.6rem] leading-none text-ink-600 hover:text-chalk">▼</button>
        </div>

        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="min-w-0 truncate text-sm text-chalk">
            {fight.redName} <span className="text-fog">vs</span> {fight.blueName}
          </span>
          {fight.mainEvent && <Badge tone="blood">Main</Badge>}
          {fight.coMain && <Badge tone="ink">Co-main</Badge>}
          {fight.titleFight && <Badge tone="gold">{fight.interimTitle ? "Interim" : "Title"}</Badge>}
          {fight.cancelled && <Badge tone="ink">Cancelled</Badge>}
          {decided && <Badge tone="ink">{fight.method ?? fight.result}</Badge>}
        </button>

        {saving && <Loader2 className="size-3 shrink-0 animate-spin text-fog" />}
        <span className="shrink-0 text-[0.65rem] tabular-nums text-ink-600">{fight.scheduledRounds}r</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-fog transition-transform", open && "rotate-180")} />
      </div>

      {issues._ && <p className="px-3 pb-1.5 text-[0.68rem] text-blood-300">{issues._}</p>}

      {open && (
        <div className="border-t border-ink-800">
          <Row label="Segment"><Select value={fight.cardSegment} onChange={(v) => onSegment(v as Segment)} options={SEGMENT_ORDER.map((s) => ({ value: s, label: SEGMENT_LABEL[s] }))} /></Row>
          <Row label="Weight class">
            <Select
              value={fight.weightClassId ?? ""}
              onChange={(v) => set("weightClassId", v || null)}
              options={[{ value: "", label: "—" }, ...weightClasses.map((w) => ({ value: w.id, label: w.name }))]}
            />
          </Row>
          <Row label="Rounds" issue={issues.scheduledRounds}>
            <Text type="number" value={String(fight.scheduledRounds)} onChange={(v) => set("scheduledRounds", Number(v) || 1)} invalid={!!issues.scheduledRounds} />
          </Row>
          <Row label="Walkout" hint="Leave empty to use the estimated schedule.">
            <DateTime value={fight.estimatedStartAt} onChange={(iso) => set("estimatedStartAt", iso)} />
          </Row>
          <Row label="Stakes">
            <div className="flex flex-wrap gap-1.5">
              <Toggle checked={fight.titleFight} onChange={(v) => set("titleFight", v)} label="Title" />
              <Toggle checked={fight.interimTitle} onChange={(v) => set("interimTitle", v)} label="Interim" />
            </div>
          </Row>
          <Row label="Status">
            <div className="flex flex-wrap gap-1.5">
              <Toggle checked={fight.cancelled} onChange={(v) => set("cancelled", v)} label="Cancelled" />
            </div>
          </Row>
          <Row label="Card note" hint="Shown on the public card, e.g. replacement info.">
            <Text value={fight.cardNote ?? ""} onChange={(v) => set("cardNote", v || null)} />
          </Row>

          <Row label="Result" issue={issues.result}>
            <Select value={fight.result} onChange={(v) => set("result", v)} options={RESULTS} />
          </Row>
          {fight.result === "WIN" && (
            <Row label="Winner" issue={issues.winnerId}>
              <Select
                value={fight.winnerId ?? ""}
                onChange={(v) => set("winnerId", v || null)}
                options={[{ value: "", label: "—" }, { value: fight.redId, label: fight.redName }, { value: fight.blueId, label: fight.blueName }]}
                invalid={!!issues.winnerId}
              />
            </Row>
          )}
          {decided && (
            <>
              <Row label="Method" issue={issues.method}><Select value={fight.method ?? ""} onChange={(v) => set("method", v || null)} options={METHODS} /></Row>
              <Row label="Round" issue={issues.roundEnded}>
                <Text type="number" value={fight.roundEnded ? String(fight.roundEnded) : ""} onChange={(v) => set("roundEnded", v ? Number(v) : null)} invalid={!!issues.roundEnded} />
              </Row>
              <Row label="Time" hint="m:ss" issue={issues.timeEnded}>
                <Text value={fight.timeEnded ?? ""} onChange={(v) => set("timeEnded", v || null)} invalid={!!issues.timeEnded} />
              </Row>
              <Row label="Bonuses">
                <div className="flex flex-wrap gap-1.5">
                  <Toggle checked={fight.performanceBonus} onChange={(v) => set("performanceBonus", v)} label="Performance" />
                  <Toggle checked={fight.fightOfTheNight} onChange={(v) => set("fightOfTheNight", v)} label="Fight of the night" />
                </div>
              </Row>
            </>
          )}

          <div className="flex justify-end px-3 py-2">
            <button onClick={onRemove} className="inline-flex items-center gap-1 rounded border border-ink-700 px-2 py-1 text-[0.7rem] font-semibold text-fog hover:border-blood-500/40 hover:text-blood-300">
              <Trash2 className="size-3" /> Remove bout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "blood" | "gold" | "ink" }) {
  const cls = tone === "blood" ? "bg-blood-500/20 text-blood-300"
    : tone === "gold" ? "bg-gold-500/15 text-gold-300"
    : "bg-ink-800 text-fog";
  return <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-bold uppercase", cls)}>{children}</span>;
}
