"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Clip } from "./clip-reels";

interface Community { slug: string; name: string }

export function UploadSheet({ onClose, onUploaded }: { onClose: () => void; onUploaded: (c: Clip) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [communities, setCommunities] = useState<Community[]>([]);
  const [community, setCommunity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/communities", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { communities: Community[] }) => setCommunities(d.communities ?? []))
      .catch(() => {});
  }, []);

  async function submit() {
    if (!file) { setError("Choose a video file."); return; }
    if (title.trim().length < 3) { setError("Give it a title."); return; }
    setBusy(true);
    setError(null);
    try {
      // Ask the server where to send the file: Cloudflare Stream (transcode +
      // poster) if configured, otherwise a direct multipart upload to our R2.
      const initRes = await fetch("/api/clips/upload-url", { method: "POST" });
      const init = await initRes.json();
      if (!initRes.ok) throw new Error(init.error ?? "Could not start upload.");

      let clip: Clip;
      if (init.mode === "stream") {
        const up = new FormData();
        up.set("file", file);
        const cf = await fetch(init.uploadURL, { method: "POST", body: up });
        if (!cf.ok) throw new Error("Upload to Cloudflare failed.");
        const res = await fetch("/api/clips", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim(), communitySlug: community || undefined, streamUid: init.uid }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not save clip.");
        clip = data.clip as Clip;
      } else {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("title", title.trim());
        if (community) fd.set("communitySlug", community);
        const res = await fetch("/api/clips", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed.");
        clip = data.clip as Clip;
      }
      onUploaded(clip);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl border border-ink-700 bg-ink-900 p-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-chalk">Upload a clip</h3>
          <button onClick={onClose} aria-label="Close" className="text-fog hover:text-chalk"><X className="size-5" /></button>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-ink-600 bg-ink-950/40 p-6 text-center transition-colors hover:border-blood-500/50"
        >
          <Film className="size-7 text-blood-400" />
          <span className="text-sm font-semibold text-chalk">{file ? file.name : "Choose a video"}</span>
          <span className="text-xs text-fog">MP4, WebM or MOV · up to 64 MB</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
        />

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title — e.g. Head-kick KO, round 2"
          maxLength={160}
          className="mt-3 w-full rounded-lg border border-ink-700 bg-ink-950/60 p-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
        />

        <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-mist">Community (optional)</label>
        <select
          value={community}
          onChange={(e) => setCommunity(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-950/60 p-2.5 text-sm text-chalk outline-none focus:border-blood-500/50"
        >
          <option value="">No community</option>
          {communities.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>

        {error && <p className="mt-3 text-sm text-blood-300">{error}</p>}

        <div className="mt-4 flex justify-end">
          <Button onClick={submit} disabled={busy || !file || title.trim().length < 3}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Uploading…</> : "Post clip"}
          </Button>
        </div>
      </div>
    </div>
  );
}
