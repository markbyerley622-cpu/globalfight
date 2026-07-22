"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Trash2, Loader2, Plus, AlertCircle, GripVertical, Star, Pencil, Check, X, Maximize2,
} from "lucide-react";
import { IMAGE_ACCEPT, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, ALLOWED_IMAGE_TYPES } from "@/lib/images/limits";
import { EmptyState } from "@/components/ui/empty-state";
import { useLightbox, type LightboxImage } from "@/components/ui/lightbox";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Gallery management.
//
//  Ordering is REAL: the tiles reorder locally for feedback and the new order
//  is persisted to GymPhoto.sortOrder, writing only the rows whose position
//  actually changed. A failed save rolls the grid back — a gallery that looks
//  reordered but isn't is worse than one that refuses.
//
//  Reorder works three ways because a gym owner is as likely to be on a phone
//  as a laptop:
//    · pointer  — one handler for mouse AND touch (HTML5 drag-and-drop does
//                 not fire on touch at all, which is why it isn't used)
//    · keyboard — focus a tile, Alt+Arrow to move it
//    · buttons  — the handle is a real button, so it is reachable and labelled
//
//  Metadata autosaves on BLUR, not per keystroke.
// ════════════════════════════════════════════════════════════════════════════

export interface GymPhoto {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  caption: string | null;
  alt: string | null;
  credit: string | null;
  takenAt: string | null;
  sortOrder: number;
}

interface Pending {
  key: string;
  preview: string;
  progress: number;
  error: string | null;
  file: File;
}

const MAX_PHOTOS = 12;

export function GymGalleryManager({
  slug, initial, coverUrl, onCoverChange,
}: {
  slug: string;
  initial: GymPhoto[];
  /** The gym's current hero, so the cover badge is accurate. */
  coverUrl?: string | null;
  onCoverChange?: (url: string) => void;
}) {
  const [photos, setPhotos] = useState<GymPhoto[]>(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(coverUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);
  const gridRef = useRef<HTMLUListElement>(null);

  useEffect(() => () => { previews.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const lightboxImages = useMemo<LightboxImage[]>(() => photos, [photos]);
  const lightbox = useLightbox(lightboxImages);

  // ── Ordering ──────────────────────────────────────────────────────────

  const persistOrder = useCallback(
    async (next: GymPhoto[], before: GymPhoto[]) => {
      setError(null);
      try {
        const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/photos`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ order: next.map((p) => p.id) }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? "Could not save the new order.");
        }
      } catch (e) {
        setPhotos(before);
        setError(e instanceof Error ? e.message : "Could not save the new order.");
      }
    },
    [slug],
  );

  const move = useCallback(
    (id: string, delta: number) => {
      setPhotos((cur) => {
        const from = cur.findIndex((p) => p.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= cur.length) return cur;
        const next = [...cur];
        const [row] = next.splice(from, 1);
        next.splice(to, 0, row);
        void persistOrder(next, cur);
        return next;
      });
    },
    [persistOrder],
  );

  /** Pointer drag — one path for mouse and touch. */
  const startDrag = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    setDragId(id);
    const onMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-photo-id]");
      const overId = el?.getAttribute("data-photo-id");
      if (!overId || overId === id) return;
      setPhotos((cur) => {
        const from = cur.findIndex((p) => p.id === id);
        const to = cur.findIndex((p) => p.id === overId);
        if (from < 0 || to < 0 || from === to) return cur;
        const next = [...cur];
        const [row] = next.splice(from, 1);
        next.splice(to, 0, row);
        return next;
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragId(null);
      // Commit whatever the live reorder settled on.
      setPhotos((cur) => { void persistOrder(cur, initial); return cur; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── Metadata ──────────────────────────────────────────────────────────

  const saveMeta = useCallback(
    async (id: string, patch: Partial<Pick<GymPhoto, "caption" | "alt" | "credit">>) => {
      const before = photos;
      setPhotos((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      try {
        const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/photos`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, ...patch }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save.");
      } catch (e) {
        setPhotos(before);
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    },
    [photos, slug],
  );

  const makeCover = useCallback(
    async (photo: GymPhoto) => {
      const before = cover;
      setCover(photo.url);
      setBusy(photo.id);
      try {
        const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/photos`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: photo.id, cover: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? "Could not set the cover.");
        if (d.heroUrl) onCoverChange?.(d.heroUrl);
      } catch (e) {
        setCover(before);
        setError(e instanceof Error ? e.message : "Could not set the cover.");
      } finally {
        setBusy(null);
      }
    },
    [cover, slug, onCoverChange],
  );

  // ── Delete ────────────────────────────────────────────────────────────

  const removeMany = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const before = photos;
      setPhotos((cur) => cur.filter((p) => !ids.includes(p.id)));
      setSelected(new Set());
      setError(null);
      try {
        const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
        const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/photos?${qs}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not remove.");
      } catch (e) {
        setPhotos(before);
        setError(e instanceof Error ? e.message : "Could not remove.");
      }
    },
    [photos, slug],
  );

  // ── Upload ────────────────────────────────────────────────────────────

  const uploadOne = useCallback(
    (file: File, key: string) =>
      new Promise<void>((resolve) => {
        const body = new FormData();
        body.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/gyms/${encodeURIComponent(slug)}/photos`);
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          setPending((cur) => cur.map((p) => (p.key === key ? { ...p, progress: pct } : p)));
        };
        xhr.onload = () => {
          let data: { photo?: GymPhoto; error?: string } = {};
          try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
          if (xhr.status >= 200 && xhr.status < 300 && data.photo) {
            setPhotos((cur) => [...cur, data.photo!]);
            setPending((cur) => cur.filter((p) => p.key !== key));
          } else {
            setPending((cur) =>
              cur.map((p) => (p.key === key ? { ...p, error: data.error ?? `Failed (${xhr.status})` } : p)),
            );
          }
          resolve();
        };
        xhr.onerror = () => {
          setPending((cur) => cur.map((p) => (p.key === key ? { ...p, error: "Network error" } : p)));
          resolve();
        };
        xhr.send(body);
      }),
    [slug],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const room = MAX_PHOTOS - photos.length - pending.length;
      if (room <= 0) { setError(`A gym can show ${MAX_PHOTOS} photos.`); return; }

      const accepted: { file: File; key: string; preview: string }[] = [];
      for (const file of files.slice(0, room)) {
        if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
          setError("Use JPG, PNG, WebP or AVIF images."); continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          setError(`Each image must be under ${MAX_UPLOAD_MB} MB.`); continue;
        }
        const preview = URL.createObjectURL(file);
        previews.current.push(preview);
        accepted.push({ file, key: `${file.name}-${file.size}-${Math.round(performance.now())}-${accepted.length}`, preview });
      }
      if (accepted.length === 0) return;

      setPending((cur) => [...cur, ...accepted.map((a) => ({ key: a.key, preview: a.preview, progress: 0, error: null, file: a.file }))]);
      // Sequential: eight concurrent 8 MB requests on a phone is eight timeouts.
      for (const a of accepted) await uploadOne(a.file, a.key);
    },
    [photos.length, pending.length, uploadOne],
  );

  const full = photos.length + pending.length >= MAX_PHOTOS;
  const anySelected = selected.size > 0;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files ?? []));
      }}
      className={cn("rounded-xl transition-colors", dragging && "bg-blood-500/10 ring-2 ring-blood-500")}
    >
      {/* Bulk bar — only when something is selected. */}
      {anySelected && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-blood-500/40 bg-blood-500/10 px-3 py-2">
          <span className="flex-1 text-[0.76rem] font-semibold text-chalk">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="tap rounded-lg border border-ink-600 px-2.5 py-1.5 text-[0.68rem] font-bold uppercase tracking-wide text-mist hover:text-chalk"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete ${selected.size} photo${selected.size === 1 ? "" : "s"}?`)) {
                void removeMany([...selected]);
              }
            }}
            className="tap inline-flex items-center gap-1.5 rounded-lg border border-down/50 bg-down/15 px-2.5 py-1.5 text-[0.68rem] font-bold uppercase tracking-wide text-down"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}

      {photos.length === 0 && pending.length === 0 ? (
        <EmptyState
          compact
          icon={<Plus className="size-5" />}
          title="No photos yet"
          body="Show the mats, the ring, the team. Drag images here or tap Add — the first photo makes a good cover."
        />
      ) : (
        <ul ref={gridRef} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p, i) => {
            const isCover = cover === p.url;
            const isSelected = selected.has(p.id);
            return (
              <li
                key={p.id}
                data-photo-id={p.id}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-xl border bg-ink-850 transition-shadow",
                  isSelected ? "border-blood-500 ring-2 ring-blood-500/50" : "border-ink-700",
                  dragId === p.id && "opacity-60 ring-2 ring-chalk",
                )}
              >
                <Image
                  src={p.thumbUrl}
                  alt={p.alt ?? p.caption ?? ""}
                  fill
                  unoptimized
                  loading="lazy"
                  sizes="(max-width: 640px) 33vw, 160px"
                  className="object-cover"
                />

                {/* Whole tile toggles selection; Alt+Arrows reorder it. */}
                <button
                  type="button"
                  aria-label={`Photo ${i + 1}${p.caption ? `: ${p.caption}` : ""}. Space to select, Alt plus arrow keys to reorder.`}
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                      return next;
                    })
                  }
                  onKeyDown={(e) => {
                    if (!e.altKey) return;
                    if (e.key === "ArrowLeft") { e.preventDefault(); move(p.id, -1); }
                    if (e.key === "ArrowRight") { e.preventDefault(); move(p.id, 1); }
                  }}
                  className="absolute inset-0 z-0"
                />

                {isCover && (
                  <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-md bg-gold-500/90 px-1.5 py-0.5 font-display text-[0.55rem] font-black uppercase tracking-wider text-ink-950">
                    <Star className="size-2.5" /> Cover
                  </span>
                )}

                {/* Controls */}
                <span className="absolute inset-x-1.5 bottom-1.5 z-10 flex items-center justify-between gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onPointerDown={startDrag(p.id)}
                    aria-label={`Drag photo ${i + 1} to reorder`}
                    className="tap grid size-6 cursor-grab touch-none place-items-center rounded border border-ink-600/80 bg-ink-950/85 text-mist backdrop-blur active:cursor-grabbing"
                  >
                    <GripVertical className="size-3" />
                  </button>
                  <span className="flex gap-1">
                    <IconBtn label={`Open photo ${i + 1}`} onClick={() => lightbox.open(i)}><Maximize2 className="size-3" /></IconBtn>
                    <IconBtn label={`Edit details for photo ${i + 1}`} onClick={() => setEditing(editing === p.id ? null : p.id)}><Pencil className="size-3" /></IconBtn>
                    {!isCover && (
                      <IconBtn label={`Make photo ${i + 1} the cover`} onClick={() => makeCover(p)}>
                        {busy === p.id ? <Loader2 className="size-3 animate-spin" /> : <Star className="size-3" />}
                      </IconBtn>
                    )}
                  </span>
                </span>
              </li>
            );
          })}

          {pending.map((p) => (
            <li key={p.key} className="relative aspect-square overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="size-full object-cover opacity-50" />
              <div className="absolute inset-x-0 bottom-0 bg-ink-950/85 px-1.5 py-1.5 backdrop-blur">
                {p.error ? (
                  <span className="block truncate text-[0.58rem] font-semibold text-down">{p.error}</span>
                ) : (
                  <div className="h-1 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Uploading photo">
                    <div className="h-full rounded-full bg-blood-500 transition-[width]" style={{ width: `${p.progress}%` }} />
                  </div>
                )}
              </div>
              {p.error && (
                <button
                  type="button"
                  onClick={() => { setPending((cur) => cur.filter((x) => x.key !== p.key)); void addFiles([p.file]); }}
                  className="absolute inset-x-0 top-0 bg-ink-950/70 py-1 text-[0.58rem] font-bold uppercase text-chalk backdrop-blur"
                >
                  Retry
                </button>
              )}
            </li>
          ))}

          {!full && (
            <li>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                aria-label="Add photos"
                className="tap flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink-700 bg-ink-850 text-fog transition-colors hover:border-ink-600 hover:text-mist"
              >
                <Plus className="size-5" />
                <span className="text-[0.6rem] font-semibold">Add</span>
              </button>
            </li>
          )}
        </ul>
      )}

      {/* Inline metadata editor for one photo. */}
      {editing && (() => {
        const p = photos.find((x) => x.id === editing);
        if (!p) return null;
        return (
          <div className="mt-3 rounded-xl border border-ink-700 bg-ink-850 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-[0.68rem] font-bold uppercase tracking-wide text-mist">Photo details</span>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close photo details"
                className="tap grid size-6 place-items-center rounded text-fog hover:text-chalk"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <MetaField label="Caption" hint="Shown under the photo" defaultValue={p.caption ?? ""} max={160}
                onCommit={(v) => v !== (p.caption ?? "") && saveMeta(p.id, { caption: v || null })} />
              <MetaField label="Alt text" hint="Describes the photo for screen readers" defaultValue={p.alt ?? ""} max={200}
                onCommit={(v) => v !== (p.alt ?? "") && saveMeta(p.id, { alt: v || null })} />
              <MetaField label="Credit" hint="Optional" defaultValue={p.credit ?? ""} max={80}
                onCommit={(v) => v !== (p.credit ?? "") && saveMeta(p.id, { credit: v || null })} />
            </div>
          </div>
        );
      })()}

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void addFiles(files);
        }}
      />

      <p className="mt-2 text-[0.66rem] leading-relaxed text-fog">
        {photos.length}/{MAX_PHOTOS} photos · drag the handle to reorder, or focus a photo and hold Alt with the
        arrow keys. Tap a photo to select it.
      </p>

      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[0.68rem] text-down">
          <AlertCircle className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      {lightbox.node}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="tap grid size-6 place-items-center rounded border border-ink-600/80 bg-ink-950/85 text-mist backdrop-blur hover:text-chalk"
    >
      {children}
    </button>
  );
}

function MetaField({
  label, hint, defaultValue, max, onCommit,
}: { label: string; hint: string; defaultValue: string; max: number; onCommit: (v: string) => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-mist">{label}</span>
        <span className="flex items-center gap-1 text-[0.6rem] text-fog">
          {saved && <Check className="size-3 text-up" />}
          {hint}
        </span>
      </span>
      <input
        type="text"
        defaultValue={defaultValue}
        maxLength={max}
        onBlur={(e) => { onCommit(e.target.value.trim()); setSaved(true); setTimeout(() => setSaved(false), 1800); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-2 text-[0.82rem] text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none"
      />
    </label>
  );
}
