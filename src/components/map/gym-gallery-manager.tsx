"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Trash2, Loader2, Plus, AlertCircle } from "lucide-react";
import { IMAGE_ACCEPT, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, ALLOWED_IMAGE_TYPES } from "@/lib/images/limits";
import { cn } from "@/lib/utils";

export interface GymPhoto {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  caption: string | null;
}

/** Optimistic row for a photo still uploading. */
interface Pending {
  key: string;
  preview: string;
  progress: number;
  error: string | null;
  file: File;
}

const MAX_PHOTOS = 12;

/**
 * Gallery management. Multi-select is supported and uploads run SEQUENTIALLY —
 * firing eight 8 MB requests at once on a phone connection is how you get eight
 * timeouts instead of eight photos.
 */
export function GymGalleryManager({ slug, initial }: { slug: string; initial: GymPhoto[] }) {
  const [photos, setPhotos] = useState<GymPhoto[]>(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => () => { previews.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

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
      for (const a of accepted) await uploadOne(a.file, a.key);
    },
    [photos.length, pending.length, uploadOne],
  );

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    const before = photos;
    setPhotos((cur) => cur.filter((p) => p.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/photos?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not remove.");
    } catch (e) {
      setPhotos(before);
      setError(e instanceof Error ? e.message : "Could not remove.");
    } finally {
      setDeleting(null);
    }
  }

  const full = photos.length + pending.length >= MAX_PHOTOS;

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
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p) => (
          <figure key={p.id} className="group relative aspect-square overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
            <Image
              src={p.thumbUrl}
              alt={p.caption ?? ""}
              fill
              unoptimized
              loading="lazy"
              sizes="(max-width: 640px) 33vw, 160px"
              className="object-cover"
            />
            <button
              type="button"
              onClick={() => remove(p.id)}
              disabled={deleting === p.id}
              aria-label="Remove photo"
              className="tap absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg border border-down/50 bg-ink-950/85 text-down opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              {deleting === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            </button>
          </figure>
        ))}

        {pending.map((p) => (
          <div key={p.key} className="relative aspect-square overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
            {/* Local preview — a photo appears the moment it is chosen. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.preview} alt="" className="size-full object-cover opacity-50" />
            <div className="absolute inset-x-0 bottom-0 bg-ink-950/85 px-1.5 py-1.5 backdrop-blur">
              {p.error ? (
                <span className="block truncate text-[0.58rem] font-semibold text-down">{p.error}</span>
              ) : (
                <div className="h-1 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100}>
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
          </div>
        ))}

        {!full && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="Add photos"
            className="tap flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink-700 bg-ink-850 text-fog transition-colors hover:border-ink-600 hover:text-mist"
          >
            <Plus className="size-5" />
            <span className="text-[0.6rem] font-semibold">Add</span>
          </button>
        )}
      </div>

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

      <p className="mt-2 text-[0.66rem] text-fog">
        {photos.length}/{MAX_PHOTOS} photos · drag images here or tap Add
      </p>

      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[0.68rem] text-down">
          <AlertCircle className="size-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
