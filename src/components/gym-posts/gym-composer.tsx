"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, RotateCw, X, Users, Lock, Globe } from "lucide-react";
import type { GymPostDTO, PostMediaDTO, Visibility } from "@/lib/gym-posts/types";
import { MAX_BODY_CHARS, MAX_MEDIA_PER_POST } from "@/lib/gym-posts/types";
import { IMAGE_ACCEPT, MAX_UPLOAD_MB } from "@/lib/images/limits";

// ════════════════════════════════════════════════════════════════════════════
//  THE COMPOSER.
//
//  ── It does not upload anything itself ───────────────────────────────────
//  Every file goes to POST /api/media — the one door to the media lifecycle —
//  and what comes back is an ASSET ID. The composer never sees a bucket, a key
//  or a signed URL, and the post it finally submits carries ids, not files.
//  That separation is what makes an image survive a failed post and a post
//  survive a failed image.
//
//  ── Why upload on SELECT rather than on submit ───────────────────────────
//  Because the scan is not instant. Uploading at submit time means the author
//  writes their post, presses Publish, and then waits while ten files are
//  validated, scanned and re-encoded — with nothing to look at and no way to
//  fix the one that fails. Uploading as each file is chosen turns that into
//  progress bars they can watch and retry individually, and by the time the
//  text is written the images are usually already READY.
//
//  The cost is that abandoning the composer leaves uploaded assets nobody
//  attached. That is exactly what the reference counting and the cleanup sweep
//  are for: an unattached asset holds no reference and is collected.
//
//  ── XMLHttpRequest, deliberately ─────────────────────────────────────────
//  fetch() still cannot report UPLOAD progress. On a phone posting a 6 MB photo
//  that is the difference between a progress bar and a frozen screen, so this
//  one place uses XHR and says why.
// ════════════════════════════════════════════════════════════════════════════

type Stage = "uploading" | "ready" | "failed";

interface Attachment {
  /** Client-side key. Stable across retries so React does not remount the tile. */
  key: string;
  file: File;
  stage: Stage;
  progress: number;
  /** Present once the lifecycle has taken it all the way to READY. */
  assetId?: string;
  preview?: PostMediaDTO;
  /** Object URL for the local thumbnail, revoked on removal. */
  localUrl: string;
  error?: string;
}

const VISIBILITY_LOOK: Record<Visibility, { icon: typeof Globe; label: string; help: string }> = {
  PUBLIC: { icon: Globe, label: "Public", help: "Anyone can see this." },
  MEMBERS: { icon: Users, label: "Members", help: "Only members of this gym." },
  PRIVATE: { icon: Lock, label: "Private", help: "Only you and the gym's owner." },
};

const draftKey = (gymSlug: string) => `gf:gymPostDraft:${gymSlug}`;
const newKey = () => `a_${Math.random().toString(36).slice(2)}`;

export function GymComposer({
  gymSlug,
  gymName,
  onPublished,
}: {
  gymSlug: string;
  gymName: string;
  onPublished: (post: GymPostDTO) => void;
}) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

  // ── Draft autosave ──────────────────────────────────────────────────────
  // TEXT ONLY. The uploaded asset ids are deliberately not persisted: by the
  // time someone returns to a day-old draft the cleanup sweep may have
  // collected those assets, and a draft that silently restores broken images is
  // worse than one that restores the words and asks for the photos again.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = localStorage.getItem(draftKey(gymSlug));
      if (saved) setBody(saved);
    } catch { /* private mode */ }
  }, [gymSlug]);

  useEffect(() => {
    if (!restored.current) return;
    // Debounced: writing to localStorage on every keystroke puts a synchronous
    // storage write on the typing path.
    const id = setTimeout(() => {
      try {
        if (body.trim()) localStorage.setItem(draftKey(gymSlug), body);
        else localStorage.removeItem(draftKey(gymSlug));
      } catch { /* private mode */ }
    }, 400);
    return () => clearTimeout(id);
  }, [body, gymSlug]);

  // Object URLs are a real leak if they are not revoked — a session of adding
  // and removing photos holds every one of them in memory otherwise.
  useEffect(() => () => {
    for (const a of attachments) URL.revokeObjectURL(a.localUrl);
    // Intentionally runs on unmount only; `attachments` is read at teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = useCallback(async (attachment: Attachment) => {
    const form = new FormData();
    form.append("file", attachment.file);
    form.append("sourceType", "gym-post");

    const update = (patch: Partial<Attachment>) =>
      setAttachments((prev) => prev.map((a) => (a.key === attachment.key ? { ...a, ...patch } : a)));

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/media");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) update({ progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => {
        let data: { assetId?: string; media?: PostMediaDTO; error?: string } = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.assetId) {
          update({ stage: "ready", progress: 100, assetId: data.assetId, preview: data.media, error: undefined });
        } else {
          // The server's own sentence. It never says WHY a file was rejected —
          // a precise refusal is a free oracle for tuning a payload until it
          // passes — so this shows what it chose to say and nothing more.
          update({ stage: "failed", error: data.error ?? "Upload failed." });
        }
        resolve();
      };
      xhr.onerror = () => { update({ stage: "failed", error: "Network error." }); resolve(); };
      xhr.onabort = () => { update({ stage: "failed", error: "Cancelled." }); resolve(); };
      xhr.send(form);
    });
  }, []);

  const accept = useCallback(
    (files: FileList | File[]) => {
      setError(null);
      const incoming = [...files].filter((f) => f.type.startsWith("image/"));
      if (incoming.length === 0) return;

      setAttachments((prev) => {
        const room = MAX_MEDIA_PER_POST - prev.length;
        if (room <= 0) {
          setError(`A post can carry ${MAX_MEDIA_PER_POST} images.`);
          return prev;
        }
        if (incoming.length > room) setError(`Only the first ${room} were added — ${MAX_MEDIA_PER_POST} is the limit.`);

        const added = incoming.slice(0, room).map<Attachment>((file) => ({
          key: newKey(),
          file,
          stage: "uploading",
          progress: 0,
          localUrl: URL.createObjectURL(file),
        }));
        // Started outside the state updater: a setState callback must stay pure,
        // and React may run it twice in development.
        queueMicrotask(() => { for (const a of added) void upload(a); });
        return [...prev, ...added];
      });
    },
    [upload],
  );

  function retry(key: string) {
    const attachment = attachments.find((a) => a.key === key);
    if (!attachment) return;
    setAttachments((prev) =>
      prev.map((a) => (a.key === key ? { ...a, stage: "uploading", progress: 0, error: undefined } : a)),
    );
    void upload(attachment);
  }

  function remove(key: string) {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.key === key);
      if (gone) URL.revokeObjectURL(gone.localUrl);
      // The uploaded asset is NOT deleted here. It holds no reference (an upload
      // is not a consumer), so the cleanup sweep collects it — and deleting it
      // from the client would be a client asking the server to destroy storage,
      // which is not a permission this app hands out.
      return prev.filter((a) => a.key !== key);
    });
  }

  async function publish() {
    const ready = attachments.filter((a) => a.stage === "ready" && a.assetId);
    if (!body.trim() && ready.length === 0) {
      setError("Write something, or add a photo.");
      return;
    }
    if (attachments.some((a) => a.stage === "uploading")) {
      setError("Wait for the photos to finish uploading.");
      return;
    }

    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/gym/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gym: gymSlug,
          body,
          visibility,
          media: ready.map((a) => ({ assetId: a.assetId })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't publish that.");

      onPublished(data.post as GymPostDTO);
      for (const a of attachments) URL.revokeObjectURL(a.localUrl);
      setAttachments([]);
      setBody("");
      try { localStorage.removeItem(draftKey(gymSlug)); } catch { /* private mode */ }
    } catch (e) {
      // The text and the attachments are left exactly as they were. A failed
      // publish that clears the composer is how people lose what they wrote.
      setError(e instanceof Error ? e.message : "Couldn't publish that.");
    } finally {
      setPublishing(false);
    }
  }

  const busy = attachments.some((a) => a.stage === "uploading");
  const Icon = VISIBILITY_LOOK[visibility].icon;

  return (
    <section
      className={`card-surface p-4 transition-colors ${dragging ? "border-blood-500/60 bg-blood-500/5" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files); }}
      aria-label={`Post to ${gymName}`}
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_CHARS))}
        // Paste-to-attach. Screenshots and phone photos arrive on the clipboard
        // far more often than through a file picker.
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length > 0) { e.preventDefault(); accept(files); }
        }}
        rows={3}
        placeholder={`Share something with ${gymName}…`}
        aria-label="What do you want to say?"
        className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 text-sm leading-relaxed text-chalk placeholder:text-fog focus:border-blood-500/50 focus:outline-none"
      />

      {attachments.length > 0 && (
        <ul className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {attachments.map((a) => (
            <li
              key={a.key}
              className="relative aspect-square overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
            >
              <Image
                src={a.preview?.thumbUrl ?? a.localUrl}
                alt=""
                fill
                sizes="120px"
                className={`object-cover ${a.stage === "ready" ? "" : "opacity-50"}`}
                unoptimized
              />

              {a.stage === "uploading" && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-ink-950/70">
                  <div
                    className="h-full bg-blood-400 transition-[width] duration-200"
                    style={{ width: `${a.progress}%` }}
                    role="progressbar"
                    aria-valuenow={a.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${a.file.name}`}
                  />
                </div>
              )}

              {a.stage === "failed" && (
                <button
                  type="button"
                  onClick={() => retry(a.key)}
                  title={a.error}
                  className="absolute inset-0 grid place-items-center bg-ink-950/80 text-2xs font-semibold text-blood-300"
                >
                  <RotateCw className="size-4" aria-hidden />
                  Retry
                </button>
              )}

              <button
                type="button"
                onClick={() => remove(a.key)}
                aria-label={`Remove ${a.file.name}`}
                className="tap absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-ink-950/85 text-chalk transition-colors hover:bg-blood-500"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => { if (e.target.files) accept(e.target.files); e.target.value = ""; }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={attachments.length >= MAX_MEDIA_PER_POST}
          className="tap flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-700 px-3 text-xs font-semibold text-mist transition-colors hover:border-blood-500/40 hover:text-blood-300 disabled:opacity-40"
        >
          <ImagePlus className="size-4" aria-hidden /> Photo
        </button>

        <label className="flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-700 px-3 text-xs font-semibold text-mist">
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="sr-only">Who can see this</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
            className="bg-transparent text-xs font-semibold text-mist focus:outline-none"
          >
            <option value="PUBLIC">Public</option>
            <option value="MEMBERS">Members</option>
            <option value="PRIVATE">Private</option>
          </select>
        </label>

        <span className="flex-1" />

        <button
          type="button"
          onClick={publish}
          disabled={publishing || busy}
          className="tap flex min-h-11 items-center gap-2 rounded-lg bg-blood-500/90 px-5 text-xs font-bold uppercase tracking-wide text-chalk transition-colors hover:bg-blood-500 disabled:opacity-50"
        >
          {publishing && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {publishing ? "Posting…" : "Post"}
        </button>
      </div>

      <p className="mt-1.5 text-2xs text-fog">
        {VISIBILITY_LOOK[visibility].help} Drag, paste or pick up to {MAX_MEDIA_PER_POST} images, {MAX_UPLOAD_MB} MB each.
      </p>

      {error && <p role="alert" className="mt-1.5 text-2xs text-blood-300">{error}</p>}
    </section>
  );
}
