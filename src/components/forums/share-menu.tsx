"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Check, Copy, Mail, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Build the canonical absolute URL for a thread (client-side, origin-aware).
function threadUrl(categorySlug: string, slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/forums/${categorySlug}/${slug}`;
}

type Channel = { key: string; label: string; href: (u: string, t: string) => string };

const CHANNELS: Channel[] = [
  { key: "x", label: "X", href: (u, t) => `https://twitter.com/intent/tweet?url=${enc(u)}&text=${enc(t)}` },
  { key: "facebook", label: "Facebook", href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}` },
  { key: "linkedin", label: "LinkedIn", href: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(u)}` },
  { key: "whatsapp", label: "WhatsApp", href: (u, t) => `https://wa.me/?text=${enc(`${t} ${u}`)}` },
  { key: "telegram", label: "Telegram", href: (u, t) => `https://t.me/share/url?url=${enc(u)}&text=${enc(t)}` },
];

const enc = encodeURIComponent;

/**
 * Share a thread to X / Facebook / LinkedIn / WhatsApp / Telegram / Email, or
 * copy the link (Phase 7). Each share records a `shareCount` increment that
 * feeds trending. Uses the native share sheet on mobile when available.
 */
export function ShareMenu({
  categorySlug, slug, title, compact,
}: {
  categorySlug: string; slug: string; title: string; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  function recordShare() {
    // Fire-and-forget; trending shouldn't block the share UX.
    fetch(`/api/forums/threads/${slug}/share`, { method: "POST" }).catch(() => {});
  }

  async function onButton() {
    const url = threadUrl(categorySlug, slug);
    // Native share sheet (mobile) — single tap to every installed app.
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title, url }); recordShare(); return; } catch { /* fell through to menu */ }
    }
    setOpen((v) => !v);
  }

  function openChannel(c: Channel) {
    const url = threadUrl(categorySlug, slug);
    window.open(c.href(url, title), "_blank", "noopener,noreferrer,width=600,height=520");
    recordShare();
    setOpen(false);
  }

  async function copyLink() {
    const url = threadUrl(categorySlug, slug);
    try { await navigator.clipboard.writeText(url); setCopied(true); recordShare(); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={onButton}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300",
        )}
      >
        <Share2 className="size-3.5" /> {!compact && "Share"}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 p-1.5 shadow-2xl shadow-black/40">
          {CHANNELS.map((c) => (
            <button key={c.key} onClick={() => openChannel(c)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk">
              {c.label}
            </button>
          ))}
          <a
            href={`mailto:?subject=${enc(title)}&body=${enc(threadUrl(categorySlug, slug))}`}
            onClick={() => { recordShare(); setOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk"
          >
            <Mail className="size-4" /> Email
          </a>
          <button onClick={copyLink}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk">
            {copied ? <Check className="size-4 text-up" /> : <Link2 className="size-4" />} {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Standalone "Copy link" button (Phase 6). */
export function CopyLinkButton({ categorySlug, slug }: { categorySlug: string; slug: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(threadUrl(categorySlug, slug)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }
  return (
    <button onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300">
      {copied ? <Check className="size-3.5 text-up" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy link"}
    </button>
  );
}
