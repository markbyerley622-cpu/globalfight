"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════════════════════
//  The Composer's upload engine. ONE lifecycle, every surface.
//
//  ── What it replaced ──────────────────────────────────────────────────────
//  Two rival implementations that behaved nothing alike:
//
//    forums (MediaComposer) — awaited each upload in a `for` loop with the
//      button disabled throughout. No preview until the server answered, no
//      progress, no retry: a failed file was a sentence of red text and the
//      picture was gone.
//    gym posts — optimistic local preview, XHR progress, per-file retry. The
//      right design, locked inside one component file where nothing else could
//      reach it.
//
//  This is the second one, generalised. The forum surfaces gain progress and
//  retry by migrating; nothing loses anything.
//
//  ── Why XHR and not fetch ─────────────────────────────────────────────────
//  `fetch` still cannot report upload progress in any shipping browser
//  (`ReadableStream` request bodies are not usable for this). A progress bar on
//  a phone upload is the difference between "working" and "frozen", so the
//  older API earns its place here.
//
//  ── Why upload on SELECT rather than on submit ────────────────────────────
//  The alternative is a submit button that appears to hang for the length of a
//  video. Uploading as soon as the file is chosen means the network work
//  overlaps with the writing, and by the time somebody finishes a sentence the
//  media is usually already there.
//
//  The cost is that abandoning a composer leaves uploaded assets nobody
//  references — which is a sweep job's problem, not a reason to make every
//  post feel slow.
// ════════════════════════════════════════════════════════════════════════════

export type AttachmentStage = "uploading" | "ready" | "failed";

/**
 * One attachment, at any point in its life.
 *
 * `T` is whatever the surface's endpoint returns for a finished upload — an
 * asset id here, a full attachment object there. The engine never inspects it;
 * it carries it back so the surface can submit it.
 */
export interface ComposerAttachment<T = unknown> {
  /** Stable across retries, so React does not remount the tile mid-upload. */
  key: string;
  /** Absent on items that were never a file (a pasted link embed). */
  file?: File;
  name: string;
  size: number;
  kind: "image" | "video" | "file" | "embed";
  stage: AttachmentStage;
  /** 0–100. Meaningful only while `stage === "uploading"`. */
  progress: number;
  /** Object URL for the instant local thumbnail. Revoked on removal. */
  localUrl: string | null;
  error?: string;
  /** The server's answer, once ready. */
  result?: T;
}

export interface UploaderConfig<T> {
  /** Where the file goes. */
  endpoint: string;
  /** Form field name. Defaults to "file". */
  field?: string;
  /** Extra form fields (a sourceType, a parent id). */
  extra?: Record<string, string>;
  /**
   * Pull the surface's result shape out of the response body.
   *
   * Returning null marks the upload FAILED even on a 2xx — an endpoint that
   * answers 200 with no usable id has not actually delivered anything, and
   * treating that as success produces an attachment that silently vanishes at
   * submit time.
   */
  parse: (json: unknown) => T | null;
}

export interface UploadsConfig<T> {
  uploader: UploaderConfig<T>;
  /** Hard ceiling on attachments. */
  max: number;
  /** Bytes. A file over this is refused locally, before any network work. */
  maxBytes?: number;
  /** MIME prefixes allowed, e.g. ["image/"]. Empty means anything. */
  accept?: string[];
}

export interface UploadsApi<T> {
  attachments: ComposerAttachment<T>[];
  /** True while ANY upload is in flight — surfaces gate submit on this. */
  busy: boolean;
  /** Local validation failure (too many, too big, wrong type). */
  error: string | null;
  /** Room left before `max`. */
  remaining: number;
  addFiles: (files: FileList | File[]) => void;
  /** Add something that was never a file — a parsed link embed. */
  addItem: (item: Omit<ComposerAttachment<T>, "key" | "stage" | "progress" | "localUrl">) => void;
  retry: (key: string) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** Only the finished ones, in order. What a surface submits. */
  ready: T[];
}

const newKey = () => `a_${Math.random().toString(36).slice(2)}`;

const kindOf = (type: string): ComposerAttachment["kind"] =>
  type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "file";

/**
 * The upload lifecycle, as a hook.
 *
 * Deliberately a hook the SURFACE calls rather than state the Composer owns:
 * the attachments have to be submitted alongside the text, and burying them
 * inside the Composer would mean every surface reaching back in through a
 * callback to find out what to post. The Composer renders and drives them; the
 * surface holds them.
 */
export function useComposerUploads<T>(config: UploadsConfig<T>): UploadsApi<T> {
  const [attachments, setAttachments] = useState<ComposerAttachment<T>[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Read through a ref so `upload` never needs the config as a dependency and
  // therefore never gets recreated mid-flight.
  const cfg = useRef(config);
  useEffect(() => { cfg.current = config; });

  const patch = useCallback((key: string, next: Partial<ComposerAttachment<T>>) => {
    setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, ...next } : a)));
  }, []);

  const upload = useCallback((att: ComposerAttachment<T>) => {
    const { endpoint, field = "file", extra, parse } = cfg.current.uploader;
    if (!att.file) return;

    const form = new FormData();
    form.append(field, att.file);
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (e) => {
      // Progress is written to the ATTACHMENT, which is what re-renders — the
      // Composer's text input is not in that subtree, so typing stays smooth
      // while a video uploads.
      if (e.lengthComputable) patch(att.key, { progress: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      let json: unknown = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
      const result = xhr.status >= 200 && xhr.status < 300 ? parse(json) : null;
      if (result !== null && result !== undefined) {
        patch(att.key, { stage: "ready", progress: 100, result, error: undefined });
      } else {
        // The server's own sentence, and nothing more. A precise refusal is a
        // free oracle for tuning a payload until it passes.
        const message = (json as { error?: string } | null)?.error;
        patch(att.key, { stage: "failed", error: message ?? "Upload failed." });
      }
    };
    xhr.onerror = () => patch(att.key, { stage: "failed", error: "Network error." });
    xhr.onabort = () => patch(att.key, { stage: "failed", error: "Cancelled." });
    xhr.send(form);
  }, [patch]);

  const addFiles = useCallback((files: FileList | File[]) => {
    setError(null);
    const { max, maxBytes, accept } = cfg.current;
    const incoming = Array.from(files);

    setAttachments((prev) => {
      const room = max - prev.length;
      if (room <= 0) { setError(`You can attach ${max} at most.`); return prev; }

      const usable: File[] = [];
      for (const f of incoming.slice(0, room)) {
        if (accept?.length && !accept.some((p) => f.type.startsWith(p))) {
          setError("That file type isn't supported here.");
          continue;
        }
        if (maxBytes && f.size > maxBytes) {
          setError(`Each file must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
          continue;
        }
        usable.push(f);
      }
      if (incoming.length > room) setError(`Only ${room} more can be attached.`);
      if (usable.length === 0) return prev;

      const added = usable.map<ComposerAttachment<T>>((file) => ({
        key: newKey(),
        file,
        name: file.name,
        size: file.size,
        kind: kindOf(file.type),
        stage: "uploading",
        progress: 0,
        // The preview exists BEFORE any network work — that is what makes the
        // whole thing feel instant.
        localUrl: file.type.startsWith("image/") || file.type.startsWith("video/")
          ? URL.createObjectURL(file)
          : null,
      }));

      // Started after the state commit, so the first progress patch cannot race
      // the row it is patching into existence.
      queueMicrotask(() => { for (const a of added) upload(a); });
      return [...prev, ...added];
    });
  }, [upload]);

  const addItem = useCallback<UploadsApi<T>["addItem"]>((item) => {
    setError(null);
    setAttachments((prev) => {
      if (prev.length >= cfg.current.max) {
        setError(`You can attach ${cfg.current.max} at most.`);
        return prev;
      }
      // Not a file, so it is READY the moment it exists — nothing to upload.
      return [...prev, { ...item, key: newKey(), stage: "ready", progress: 100, localUrl: null }];
    });
  }, []);

  const retry = useCallback((key: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.key === key);
      if (found?.file) queueMicrotask(() => upload({ ...found, stage: "uploading", progress: 0 }));
      return prev.map((a) => (a.key === key ? { ...a, stage: "uploading", progress: 0, error: undefined } : a));
    });
  }, [upload]);

  const remove = useCallback((key: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.key === key);
      // Object URLs are a real leak if they are not revoked — a session of
      // adding and removing photos holds every one of them in memory.
      if (found?.localUrl) URL.revokeObjectURL(found.localUrl);
      // The uploaded asset is NOT deleted server-side. It holds no reference,
      // so the media sweep collects it; issuing a delete from here would mean
      // trusting a client to remove somebody's bytes.
      return prev.filter((a) => a.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) if (a.localUrl) URL.revokeObjectURL(a.localUrl);
      return [];
    });
    setError(null);
  }, []);

  // Revoke anything still held when the composer unmounts.
  useEffect(() => () => {
    // Intentionally reads the latest list at teardown only.
    setAttachments((prev) => {
      for (const a of prev) if (a.localUrl) URL.revokeObjectURL(a.localUrl);
      return prev;
    });
  }, []);

  return {
    attachments,
    busy: attachments.some((a) => a.stage === "uploading"),
    error,
    remaining: config.max - attachments.length,
    addFiles,
    addItem,
    retry,
    remove,
    clear,
    ready: attachments.flatMap((a) => (a.stage === "ready" && a.result !== undefined ? [a.result] : [])),
  };
}
