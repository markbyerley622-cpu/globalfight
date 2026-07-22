"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Upload, X, Trash2, RotateCw, Loader2, AlertCircle, ImagePlus } from "lucide-react";
import { IMAGE_ACCEPT, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, ALLOWED_IMAGE_TYPES } from "@/lib/images/limits";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  One image uploader for the whole app.
//
//  XMLHttpRequest, not fetch: fetch cannot report upload progress. A progress
//  bar is the difference between "this is working" and "this is broken" on a
//  phone connection, and it is also what makes CANCEL possible — xhr.abort()
//  stops the transfer, whereas an AbortController on fetch only stops you
//  listening to it.
//
//  The preview is a local object URL shown the instant a file is chosen, so the
//  new image appears before a single byte is sent. On failure it is discarded
//  and the previous image returns — an optimistic preview that survives a
//  failed upload is a lie about what is stored.
//
//  Accessibility: the drop zone is a real <button> (keyboard, screen reader,
//  focus ring), drag/drop is an enhancement on top, and the file input is the
//  actual control rather than a hidden div listening for clicks.
// ════════════════════════════════════════════════════════════════════════════

type Status = "idle" | "uploading" | "error";

export interface ImageUploadProps {
  /** Currently stored image, if any. */
  value: string | null;
  /** POST target. The component appends `file` (+ any `extraFields`). */
  endpoint: string;
  extraFields?: Record<string, string>;
  /** DELETE target. Omit to hide the remove control. */
  deleteEndpoint?: string;
  label: string;
  hint?: string;
  /** Frame shape — a logo is square, a hero is a banner. */
  aspect?: "square" | "wide";
  onUploaded: (url: string) => void;
  onRemoved?: () => void;
  className?: string;
}

export function ImageUpload({
  value, endpoint, extraFields, deleteEndpoint, label, hint, aspect = "wide",
  onUploaded, onRemoved, className,
}: ImageUploadProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const lastFile = useRef<File | null>(null);
  const previewRef = useRef<string | null>(null);

  // Object URLs are a memory leak until revoked.
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const clearPreview = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview(null);
  }, []);

  const upload = useCallback(
    (file: File) => {
      // Client-side mirror of the server policy — a fast, local error beats an
      // 8 MB round trip that ends in 413. The server still re-checks.
      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        setStatus("error"); setError("Use a JPG, PNG, WebP or AVIF image."); return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setStatus("error"); setError(`Image must be under ${MAX_UPLOAD_MB} MB.`); return;
      }

      lastFile.current = file;
      clearPreview();
      const objectUrl = URL.createObjectURL(file);
      previewRef.current = objectUrl;
      setPreview(objectUrl);
      setStatus("uploading");
      setProgress(0);
      setError(null);

      const body = new FormData();
      body.append("file", file);
      for (const [k, v] of Object.entries(extraFields ?? {})) body.append(k, v);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", endpoint);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        xhrRef.current = null;
        let data: { url?: string; photo?: { url: string }; error?: string } = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          const url = data.url ?? data.photo?.url;
          setStatus("idle");
          setProgress(100);
          if (url) onUploaded(url);
          // Keep showing the local preview until the parent swaps in the stored
          // URL; dropping it here flashes the old image for one frame.
          setTimeout(clearPreview, 400);
        } else {
          setStatus("error");
          setError(data.error ?? `Upload failed (${xhr.status}).`);
          clearPreview();
        }
      };
      xhr.onerror = () => {
        xhrRef.current = null;
        setStatus("error");
        setError("Network error. Check your connection and retry.");
        clearPreview();
      };
      xhr.onabort = () => {
        xhrRef.current = null;
        setStatus("idle");
        setProgress(0);
        clearPreview();
      };
      xhr.send(body);
    },
    [endpoint, extraFields, onUploaded, clearPreview],
  );

  const cancel = () => xhrRef.current?.abort();
  const retry = () => { if (lastFile.current) upload(lastFile.current); };

  async function remove() {
    if (!deleteEndpoint) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(deleteEndpoint, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not remove.");
      onRemoved?.();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not remove.");
    } finally {
      setRemoving(false);
    }
  }

  const shown = preview ?? value;
  const busy = status === "uploading" || removing;

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-display text-[0.68rem] font-bold uppercase tracking-wide text-mist">{label}</span>
        {hint && <span className="text-[0.62rem] text-fog">{hint}</span>}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        className={cn(
          "relative overflow-hidden rounded-xl border-2 border-dashed transition-colors",
          dragging ? "border-blood-500 bg-blood-500/10" : "border-ink-700 bg-ink-850",
          aspect === "square" ? "aspect-square max-w-[9rem]" : "aspect-[16/7]",
        )}
      >
        {/* The whole frame is one focusable control. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={shown ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
          className="absolute inset-0 z-10 flex size-full flex-col items-center justify-center gap-1.5 text-center disabled:cursor-wait"
        >
          {!shown && (
            <>
              <span className="grid size-9 place-items-center rounded-xl border border-ink-700 bg-ink-900 text-fog">
                {aspect === "square" ? <ImagePlus className="size-4" /> : <Upload className="size-4" />}
              </span>
              <span className="px-3 text-[0.68rem] font-semibold text-mist">
                Drop an image or <span className="text-blood-300 underline underline-offset-2">browse</span>
              </span>
              <span className="text-[0.6rem] text-fog">JPG · PNG · WebP · max {MAX_UPLOAD_MB} MB</span>
            </>
          )}
        </button>

        {shown && (
          <Image
            src={shown}
            alt=""
            fill
            unoptimized
            sizes={aspect === "square" ? "144px" : "(max-width: 768px) 100vw, 640px"}
            className={cn("object-cover transition-opacity", busy && "opacity-50")}
          />
        )}

        {/* Progress */}
        {status === "uploading" && (
          <div className="absolute inset-x-0 bottom-0 z-20 bg-ink-950/85 px-2.5 py-2 backdrop-blur">
            <div className="flex items-center gap-2">
              <Loader2 className="size-3 shrink-0 animate-spin text-blood-300" />
              <div
                className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Uploading ${label.toLowerCase()}`}
              >
                <div className="h-full rounded-full bg-blood-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
              </div>
              <span className="shrink-0 text-[0.6rem] tabular-nums text-mist">{progress}%</span>
              <button
                type="button"
                onClick={cancel}
                aria-label="Cancel upload"
                className="shrink-0 rounded p-0.5 text-fog hover:text-chalk"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Replace / remove, once something is stored */}
        {shown && status !== "uploading" && (
          <div className="absolute right-2 top-2 z-20 flex gap-1.5">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              aria-label={`Replace ${label.toLowerCase()}`}
              className="tap grid size-7 place-items-center rounded-lg border border-ink-600/80 bg-ink-950/80 text-mist backdrop-blur hover:text-chalk"
            >
              <RotateCw className="size-3.5" />
            </button>
            {deleteEndpoint && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                aria-label={`Remove ${label.toLowerCase()}`}
                className="tap grid size-7 place-items-center rounded-lg border border-down/50 bg-ink-950/80 text-down backdrop-blur hover:bg-down/20"
              >
                {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </button>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Reset so choosing the SAME file again still fires a change event.
            e.target.value = "";
            if (f) upload(f);
          }}
        />
      </div>

      {status === "error" && error && (
        <div role="alert" className="mt-1.5 flex items-start gap-1.5 text-[0.68rem] text-down">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          {lastFile.current && (
            <button type="button" onClick={retry} className="shrink-0 font-semibold underline underline-offset-2 hover:text-chalk">
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
