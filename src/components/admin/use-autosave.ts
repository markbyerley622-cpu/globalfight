"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════════════════════
//  Autosave.
//
//  The contract an operator needs is narrow but absolute: never lose an edit,
//  never silently overwrite a colleague, and always be honest about which of
//  those two is happening right now.
//
//  · Debounced — a burst of typing is one request, not one per keystroke.
//  · Coalescing — edits made WHILE a save is in flight are not dropped; they
//    queue and fire immediately after, so the last keystroke always lands.
//  · Conflict-aware — the server compares an updatedAt baseline and 409s. We
//    surface that rather than clobbering, because two people on a card during
//    fight week is normal, not an edge case.
//  · Field-scoped errors — 422 returns per-field issues that the form renders
//    inline; the value stays on screen so nothing typed is thrown away.
// ════════════════════════════════════════════════════════════════════════════

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export interface FieldIssue { field: string; message: string }

interface SaveResponse {
  ok?: boolean;
  issues?: FieldIssue[];
  conflict?: { updatedAt: string };
  event?: { updatedAt: string; lockedFields: string[] };
}

export interface AutosaveApi<T> {
  state: SaveState;
  issues: FieldIssue[];
  /** Fields the operator now owns — ingest will not overwrite them. */
  lockedFields: string[];
  /** Merge a partial change and schedule a save. */
  update: (patch: Partial<T>) => void;
  /** Force an immediate flush (blur, Cmd+S, navigation). */
  flush: () => Promise<void>;
  /** Take the server's version after a conflict. */
  reload: () => void;
  issueFor: (field: string) => string | null;
}

// `T` is the editable shape, not an index-signature bag — the caller's concrete
// interface is what makes `update({ name })` type-check against a typo.
export function useAutosave<T>({
  endpoint, initialUpdatedAt, initialLocked, delay = 700, onSaved,
}: {
  endpoint: string;
  initialUpdatedAt: string;
  initialLocked: string[];
  delay?: number;
  onSaved?: (locked: string[]) => void;
}): AutosaveApi<T> {
  const [state, setState] = useState<SaveState>("idle");
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [lockedFields, setLockedFields] = useState<string[]>(initialLocked);

  // Refs, not state: these are written from timers and async callbacks where a
  // stale closure would silently drop an edit.
  const pending = useRef<Record<string, unknown>>({});
  const baseline = useRef(initialUpdatedAt);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(async () => {
    if (inFlight.current) return;            // a queued flush runs when this one lands
    const patch = pending.current;
    if (!Object.keys(patch).length) return;

    pending.current = {};
    inFlight.current = true;
    setState("saving");

    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch, expectedUpdatedAt: baseline.current }),
      });
      const data = (await res.json()) as SaveResponse;

      if (res.status === 409) {
        setState("conflict");
        setIssues([]);
        return;
      }
      if (res.status === 422) {
        // Put the rejected values BACK in the queue: the operator can still see
        // them on screen, and fixing one field re-submits the whole edit.
        pending.current = { ...patch, ...pending.current };
        setIssues(data.issues ?? []);
        setState("error");
        return;
      }
      if (!res.ok) { pending.current = { ...patch, ...pending.current }; setState("error"); return; }

      if (data.event) {
        baseline.current = data.event.updatedAt;
        setLockedFields(data.event.lockedFields);
        onSaved?.(data.event.lockedFields);
      }
      setIssues([]);
      setState(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch {
      pending.current = { ...patch, ...pending.current };
      setState("error");
    } finally {
      inFlight.current = false;
      // Anything typed during the request goes out now, not on the next keystroke.
      if (Object.keys(pending.current).length) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void send(), 60);
      }
    }
  }, [endpoint, onSaved]);

  const update = useCallback((patch: Partial<T>) => {
    pending.current = { ...pending.current, ...patch };
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(), delay);
  }, [delay, send]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await send();
  }, [send]);

  // Cmd/Ctrl+S saves now. Operators press it regardless of whether an app has
  // autosave, and letting the browser show a Save-Page dialog reads as broken.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void flush(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  // Last line of defence against a closed tab with an unsaved edit.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const reload = useCallback(() => { window.location.reload(); }, []);
  const issueFor = useCallback(
    (field: string) => issues.find((i) => i.field === field)?.message ?? null,
    [issues],
  );

  return { state, issues, lockedFields, update, flush, reload, issueFor };
}
