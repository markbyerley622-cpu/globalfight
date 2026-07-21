"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Check, Copy, Mail, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ONE share control for the whole product — events, fights, fighters, rankings,
// threads. It takes a site-relative `path` and resolves the absolute URL from
// the live origin, so it works identically on localhost, preview and production
// without any config. `onShared` is how a surface records its own analytics
// (the forum increments shareCount for trending); nothing else is surface-aware.

type Channel = { key: string; label: string; href: (u: string, t: string) => string };

const enc = encodeURIComponent;

const CHANNELS: Channel[] = [
  { key: "x", label: "X", href: (u, t) => `https://twitter.com/intent/tweet?url=${enc(u)}&text=${enc(t)}` },
  { key: "facebook", label: "Facebook", href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}` },
  { key: "reddit", label: "Reddit", href: (u, t) => `https://www.reddit.com/submit?url=${enc(u)}&title=${enc(t)}` },
  { key: "whatsapp", label: "WhatsApp", href: (u, t) => `https://wa.me/?text=${enc(`${t} ${u}`)}` },
  { key: "telegram", label: "Telegram", href: (u, t) => `https://t.me/share/url?url=${enc(u)}&text=${enc(t)}` },
];

const absolute = (path: string): string =>
  typeof window === "undefined" ? path : `${window.location.origin}${path}`;

export function ShareMenu({
  path, title, compact, label = "Share", onShared, className,
}: {
  /** Site-relative path, e.g. "/events/ufc-300". */
  path: string;
  title: string;
  compact?: boolean;
  label?: string;
  /** Fire-and-forget hook for the surface's own share analytics. */
  onShared?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  async function onButton() {
    const url = absolute(path);
    // Native share sheet (mobile) — one tap to every installed app.
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title, url }); onShared?.(); return; } catch { /* fall through to the menu */ }
    }
    setOpen((v) => !v);
  }

  function openChannel(c: Channel) {
    window.open(c.href(absolute(path), title), "_blank", "noopener,noreferrer,width=600,height=520");
    onShared?.();
    setOpen(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absolute(path));
      setCopied(true);
      onShared?.();
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard denied — the channel list is still there */ }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={onButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? label : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
      >
        <Share2 className="size-3.5" /> {!compact && label}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 p-1.5 shadow-2xl shadow-black/40">
          {CHANNELS.map((c) => (
            <button key={c.key} role="menuitem" onClick={() => openChannel(c)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk">
              {c.label}
            </button>
          ))}
          <a
            role="menuitem"
            href={`mailto:?subject=${enc(title)}&body=${enc(absolute(path))}`}
            onClick={() => { onShared?.(); setOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk"
          >
            <Mail className="size-4" /> Email
          </a>
          <button role="menuitem" onClick={copyLink}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk">
            {copied ? <Check className="size-4 text-up" /> : <Link2 className="size-4" />} {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Standalone "Copy link" button. */
export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(absolute(path)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }
  return (
    <button type="button" onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400">
      {copied ? <Check className="size-3.5 text-up" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy link"}
    </button>
  );
}
