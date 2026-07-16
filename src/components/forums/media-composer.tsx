"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Link2, Loader2, X, Youtube, Instagram } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseEmbed, type ForumAttachment } from "@/lib/forum/embeds";

const MAX = 8;

/** Small platform glyph for an embed chip. */
function embedIcon(type: ForumAttachment["type"]) {
  if (type === "youtube") return <Youtube className="size-4 text-red-400" />;
  if (type === "instagram") return <Instagram className="size-4 text-pink-400" />;
  return <Link2 className="size-4 text-sky-400" />;
}

/**
 * Attach images (multi-upload, processed into WebP + thumbnail server-side) and
 * social embeds (YouTube / Instagram / X / TikTok) to a post. Controlled:
 * parent owns the attachments array and submits it with the post.
 */
export function MediaComposer({
  attachments, onChange,
}: {
  attachments: ForumAttachment[];
  onChange: (next: ForumAttachment[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX - attachments.length;

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, remaining);
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    setUploading(true);
    try {
      const added: ForumAttachment[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) { setError("Only images can be uploaded."); continue; }
        if (file.size > 10 * 1024 * 1024) { setError("Each image must be under 10 MB."); continue; }
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/forums/upload", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error ?? "Upload failed."); continue; }
        added.push(data.attachment as ForumAttachment);
      }
      if (added.length) onChange([...attachments, ...added].slice(0, MAX));
    } finally {
      setUploading(false);
    }
  }

  function addLink() {
    const parsed = parseEmbed(linkValue);
    if (!parsed) { setError("Paste a YouTube, Instagram, X or TikTok link."); return; }
    setError(null);
    onChange([...attachments, parsed].slice(0, MAX));
    setLinkValue("");
    setLinkOpen(false);
  }

  function removeAt(i: number) {
    onChange(attachments.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} disabled={uploading || remaining <= 0} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || remaining <= 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-950/40 px-2.5 py-1.5 text-xs font-semibold text-mist transition-colors hover:border-blood-500/40 hover:text-chalk disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} Photo
        </button>
        <button
          type="button"
          onClick={() => setLinkOpen((v) => !v)}
          disabled={remaining <= 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-950/40 px-2.5 py-1.5 text-xs font-semibold text-mist transition-colors hover:border-blood-500/40 hover:text-chalk disabled:opacity-50"
        >
          <Link2 className="size-4" /> Embed link
        </button>
        {attachments.length > 0 && <span className="text-xs text-fog">{attachments.length}/{MAX}</span>}
      </div>

      {linkOpen && (
        <div className="flex gap-2">
          <input
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
            placeholder="Paste a YouTube, Instagram, X or TikTok URL"
            className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
          />
          <button type="button" onClick={addLink} className="rounded-lg bg-blood-500 px-3 py-2 text-xs font-semibold uppercase text-white hover:bg-blood-400">Add</button>
        </div>
      )}

      {error && <p className="text-xs text-blood-300">{error}</p>}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div key={i} className="relative">
              {a.type === "image" || a.type === "youtube" ? (
                <div className="relative size-16 overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
                  <Image src={a.type === "image" ? (a.thumbUrl ?? a.url) : a.thumbUrl} alt="" fill className="object-cover" sizes="64px" />
                </div>
              ) : (
                <div className="flex h-16 items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-950/60 px-3 text-xs text-mist">
                  {embedIcon(a.type)}
                  <span className="capitalize">{a.type === "x" ? "X post" : a.type}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label="Remove attachment"
                className={cn("absolute -right-1.5 -top-1.5 rounded-full bg-ink-800 p-0.5 text-chalk ring-1 ring-ink-600 hover:bg-blood-500")}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
