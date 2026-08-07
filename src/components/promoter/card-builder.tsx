"use client";

import { useCallback, useRef, useState } from "react";
import { GripVertical, Plus, Trash2, Crown } from "lucide-react";
import { InlineField, InlineToggle } from "@/components/promoter/inline-field";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  THE FIGHT CARD — arranged, not edited.
//
//  ── Why not a list of form rows ───────────────────────────────────────────
//  A card has an ORDER and that order is the product: main event, co-main,
//  then down the bill. A table with an "order" number column makes the promoter
//  do the arithmetic — renumber four rows to move one bout up — and the thing
//  they are actually building is invisible until they save and go and look at
//  it. So this renders the card the way a fan will see it and lets them move
//  the bouts around inside it.
//
//  ── Why pointer events and not HTML5 drag-and-drop ────────────────────────
//  The HTML5 drag API does not fire on touch. At all. A card builder built on
//  `draggable` works beautifully on a laptop and is completely inert on the
//  device this feature is for — a promoter building their card on a phone.
//  Pointer events cover mouse, touch and pen through one code path.
//
//  `touch-action: none` on the HANDLE only, not the row: taking it on the whole
//  row would kill vertical page scrolling everywhere near the card.
//
//  ── Reordering is not only a gesture ──────────────────────────────────────
//  A drag is unusable with a keyboard and hostile with a motor impairment, so
//  every row can also be moved with Alt+ArrowUp / Alt+ArrowDown while focused.
//  Same operation, same state, announced.
// ════════════════════════════════════════════════════════════════════════════

export interface BoutRow {
  /** Stable across reorders — index would remount every row on every move. */
  id: string;
  redName: string;
  blueName: string;
  weightClass: string;
  titleFight: boolean;
  /** True when extraction was unsure about this bout's names. */
  uncertain?: boolean;
}

export function CardBuilder({
  bouts, onChange, disabled = false,
}: {
  bouts: BoutRow[];
  onChange: (next: BoutRow[]) => void;
  disabled?: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Row rectangles, measured once per drag — never per pointermove. */
  const rects = useRef<DOMRect[]>([]);

  const move = useCallback((from: number, to: number) => {
    if (to < 0 || to >= bouts.length || from === to) return;
    const next = [...bouts];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  }, [bouts, onChange]);

  const patch = useCallback((id: string, fields: Partial<BoutRow>) => {
    onChange(bouts.map((b) => (b.id === id ? { ...b, ...fields } : b)));
  }, [bouts, onChange]);

  function onPointerDown(e: React.PointerEvent, id: string) {
    if (disabled) return;
    // Capture on the HANDLE, so the drag survives the pointer leaving the row —
    // which it will, because the row moves out from under the finger.
    (e.target as Element).setPointerCapture(e.pointerId);
    const rows = listRef.current?.querySelectorAll("[data-bout-row]");
    rects.current = rows ? [...rows].map((r) => r.getBoundingClientRect()) : [];
    setDragId(id);
    setOverIndex(bouts.findIndex((b) => b.id === id));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragId || rects.current.length === 0) return;
    const y = e.clientY;
    // Which row's vertical midpoint the pointer has passed. Measured rects
    // rather than live ones: reading layout on every move would force a reflow
    // per frame, and the rows are moving anyway.
    let target = rects.current.findIndex((r) => y < r.top + r.height / 2);
    if (target === -1) target = rects.current.length - 1;
    if (target !== overIndex) setOverIndex(target);
  }

  function onPointerUp() {
    if (dragId !== null && overIndex !== null) {
      move(bouts.findIndex((b) => b.id === dragId), overIndex);
    }
    setDragId(null);
    setOverIndex(null);
    rects.current = [];
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    // Alt as the modifier: bare arrows must keep moving focus between rows.
    if (!e.altKey) return;
    if (e.key === "ArrowUp") { e.preventDefault(); move(index, index - 1); }
    if (e.key === "ArrowDown") { e.preventDefault(); move(index, index + 1); }
  }

  function addBout() {
    onChange([
      ...bouts,
      {
        id: `new-${bouts.length}-${bouts.reduce((n, b) => n + b.id.length, 0)}`,
        redName: "", blueName: "", weightClass: "", titleFight: false,
      },
    ]);
  }

  return (
    <div className="space-y-2">
      <ul ref={listRef} className="space-y-2">
        {bouts.map((bout, i) => {
          const dragging = bout.id === dragId;
          return (
            <li
              key={bout.id}
              data-bout-row
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "relative rounded-xl border bg-ink-900/70 transition-[border-color,box-shadow,transform] duration-150",
                dragging
                  ? "z-10 scale-[1.02] border-blood-500/60 shadow-[0_18px_40px_-14px_rgba(0,0,0,0.9)]"
                  : "border-ink-800",
                // The gap the dragged row will land in.
                !dragging && overIndex === i && dragId && "border-blood-500/40",
              )}
            >
              {/* ── The bill position ─────────────────────────────────────
                  MAIN EVENT is a crown and a word, not "1". A promoter thinks
                  in "main event / co-main / undercard", and a number column is
                  the thing this screen exists to replace. */}
              <div className="flex items-center gap-2 border-b border-ink-800/70 px-3 py-1.5">
                <button
                  type="button"
                  aria-label={`Reorder ${bout.redName || "bout"}. Or hold Alt and press the up and down arrows.`}
                  onPointerDown={(e) => onPointerDown(e, bout.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  disabled={disabled}
                  // touch-action:none HERE ONLY — on the row it would break
                  // page scrolling anywhere near the card.
                  className="tap -ml-1 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-fog hover:bg-ink-800 hover:text-mist active:cursor-grabbing"
                >
                  <GripVertical className="size-4" aria-hidden />
                </button>

                <span className={cn(
                  "flex items-center gap-1.5 font-display text-3xs font-black uppercase tracking-[0.14em]",
                  i === 0 ? "text-volt-300" : "text-fog",
                )}>
                  {i === 0 && <Crown className="size-3" aria-hidden />}
                  {i === 0 ? "Main event" : i === 1 ? "Co-main" : `Bout ${bouts.length - i}`}
                </span>

                <button
                  type="button"
                  onClick={() => onChange(bouts.filter((b) => b.id !== bout.id))}
                  disabled={disabled}
                  aria-label={`Remove ${bout.redName || "this bout"}`}
                  className="tap ml-auto grid size-8 place-items-center rounded-md text-fog transition-colors hover:bg-blood-500/10 hover:text-blood-300"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>

              {/* ── The bout, as a fan sees it ───────────────────────────── */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <InlineField
                    value={bout.redName}
                    onCommit={(v) => patch(bout.id, { redName: v })}
                    placeholder="Red corner"
                    label="Red corner fighter"
                    size={i === 0 ? "lg" : "md"}
                    uncertain={bout.uncertain}
                    disabled={disabled}
                  />
                </div>
                <span aria-hidden className="shrink-0 font-display text-xs font-black uppercase text-blood-400">
                  vs
                </span>
                <div className="min-w-0 flex-1">
                  <InlineField
                    value={bout.blueName}
                    onCommit={(v) => patch(bout.id, { blueName: v })}
                    placeholder="Blue corner"
                    label="Blue corner fighter"
                    size={i === 0 ? "lg" : "md"}
                    uncertain={bout.uncertain}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5">
                <div className="min-w-0 flex-1">
                  <InlineField
                    value={bout.weightClass}
                    onCommit={(v) => patch(bout.id, { weightClass: v })}
                    placeholder="Weight class"
                    label="Weight class"
                    size="sm"
                    disabled={disabled}
                  />
                </div>
                <InlineToggle
                  value={bout.titleFight}
                  onCommit={(v) => patch(bout.id, { titleFight: v })}
                  label="Title fight"
                />
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={addBout}
        disabled={disabled}
        className="tap flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink-700 text-xs font-bold uppercase tracking-wider text-fog transition-colors hover:border-blood-500/50 hover:text-mist"
      >
        <Plus className="size-4" aria-hidden /> Add a bout
      </button>

      {/* Stated once, quietly. Discoverability for the keyboard path without
          putting instructions on every row. */}
      {bouts.length > 1 && (
        <p className="px-1 text-3xs text-fog">
          Drag <GripVertical className="inline size-3 align-text-bottom" aria-hidden /> to reorder — or hold Alt and use the arrow keys.
        </p>
      )}
    </div>
  );
}
