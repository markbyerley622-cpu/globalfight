"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ExternalLink, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ForumAttachment } from "@/lib/forum/embeds";

// ─── External embed script loader ─────────────────────────────────────────
// Instagram / X / TikTok render via each platform's official embed script. We
// load each script once (idempotent) and re-run its processor after mount.

const scriptState: Record<string, "loading" | "ready"> = {};
const waiters: Record<string, Array<() => void>> = {};

function loadScript(src: string): Promise<void> {
  if (scriptState[src] === "ready") return Promise.resolve();
  return new Promise((resolve) => {
    (waiters[src] ??= []).push(resolve);
    if (scriptState[src] === "loading") return;
    scriptState[src] = "loading";
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => { scriptState[src] = "ready"; (waiters[src] ?? []).forEach((w) => w()); waiters[src] = []; };
    el.onerror = () => { (waiters[src] ?? []).forEach((w) => w()); waiters[src] = []; };
    document.body.appendChild(el);
  });
}

type WindowEmbeds = Window & {
  instgrm?: { Embeds: { process: () => void } };
  twttr?: { widgets: { load: (el?: HTMLElement) => void } };
};

function SocialEmbed({ a }: { a: Extract<ForumAttachment, { type: "instagram" | "x" | "tiktok" }> }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as WindowEmbeds;
    if (a.type === "instagram") {
      loadScript("https://www.instagram.com/embed.js").then(() => w.instgrm?.Embeds.process());
    } else if (a.type === "x") {
      loadScript("https://platform.twitter.com/widgets.js").then(() => w.twttr?.widgets.load(ref.current ?? undefined));
    } else if (a.type === "tiktok") {
      loadScript("https://www.tiktok.com/embed.js");
    }
  }, [a]);

  const fallback = (
    <a href={a.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blood-400 hover:text-blood-300">
      <ExternalLink className="size-3.5" /> Open on {a.type === "x" ? "X" : a.type === "instagram" ? "Instagram" : "TikTok"}
    </a>
  );

  return (
    <div ref={ref} className="overflow-hidden rounded-card border border-ink-700 bg-ink-950/40 p-2">
      {a.type === "instagram" && (
        <blockquote className="instagram-media" data-instgrm-permalink={a.url} data-instgrm-version="14" style={{ margin: 0, width: "100%" }}>
          {fallback}
        </blockquote>
      )}
      {a.type === "x" && (
        <blockquote className="twitter-tweet" data-dnt="true" data-theme="dark">
          <a href={a.url}>{fallback}</a>
        </blockquote>
      )}
      {a.type === "tiktok" && (
        <blockquote className="tiktok-embed" cite={a.url} style={{ margin: 0 }}>
          <section>{fallback}</section>
        </blockquote>
      )}
    </div>
  );
}

// ─── Image lightbox ───────────────────────────────────────────────────────

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/90 p-4" onClick={onClose}>
      <button className="absolute right-4 top-4 rounded-full bg-ink-800/80 p-2 text-chalk" aria-label="Close"><X className="size-5" /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="max-h-[90vh] max-w-full rounded-lg object-contain" />
    </div>
  );
}

// ─── Grid ─────────────────────────────────────────────────────────────────

function ImageTile({ a, onOpen }: { a: Extract<ForumAttachment, { type: "image" }>; onOpen: () => void }) {
  const ratio = a.width && a.height ? a.width / a.height : 16 / 10;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block w-full overflow-hidden rounded-card border border-ink-700 bg-ink-950/40"
      style={{ aspectRatio: String(ratio) }}
    >
      <Image
        src={a.thumbUrl ?? a.url}
        alt={a.caption ?? "Attached image"}
        fill
        loading="lazy"
        sizes="(max-width: 640px) 100vw, 50vw"
        className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />
    </button>
  );
}

export function AttachmentGrid({ attachments }: { attachments: ForumAttachment[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  if (!attachments?.length) return null;

  const images = attachments.filter((a) => a.type === "image") as Extract<ForumAttachment, { type: "image" }>[];
  const youtube = attachments.filter((a) => a.type === "youtube") as Extract<ForumAttachment, { type: "youtube" }>[];
  const videos = attachments.filter((a) => a.type === "video") as Extract<ForumAttachment, { type: "video" }>[];
  const socials = attachments.filter((a) => a.type === "instagram" || a.type === "x" || a.type === "tiktok") as Extract<ForumAttachment, { type: "instagram" | "x" | "tiktok" }>[];

  return (
    <div className="mt-3 space-y-3">
      {images.length > 0 && (
        <div className={cn("grid gap-2", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {images.map((a, i) => <ImageTile key={i} a={a} onOpen={() => setLightbox(a.url)} />)}
        </div>
      )}

      {youtube.map((a, i) => (
        <div key={`yt${i}`} className="relative overflow-hidden rounded-card border border-ink-700" style={{ aspectRatio: "16 / 9" }}>
          <iframe
            src={`https://www.youtube.com/embed/${a.videoId}`}
            title="YouTube video"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 size-full"
          />
        </div>
      ))}

      {videos.map((a, i) => (
        <video key={`v${i}`} src={a.url} poster={a.thumbUrl ?? undefined} controls preload="metadata"
          className="w-full rounded-card border border-ink-700 bg-black">
          <a href={a.url}><Play className="size-4" /> Play video</a>
        </video>
      ))}

      {socials.map((a, i) => <SocialEmbed key={`s${i}`} a={a} />)}

      {lightbox && <Lightbox src={lightbox} alt="Attachment" onClose={() => setLightbox(null)} />}
    </div>
  );
}
