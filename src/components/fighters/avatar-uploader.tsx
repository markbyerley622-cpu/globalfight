"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Owner-only overlay around the profile avatar. Hovering reveals a "Change
 * photo" control; selecting an image uploads it to the avatar endpoint and
 * refreshes the page so the new photo shows everywhere immediately.
 *
 * Render `children` = the <FighterAvatar> so the overlay sits exactly on top.
 */
export function AvatarUploader({ slug, children, className }: { slug: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Please choose an image file."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("Image must be under 8 MB."); return; }

    setError(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/fighters/${slug}/avatar`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      router.refresh(); // re-render server components with the new photo
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("group/avatar relative", className)}>
      {children}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} disabled={busy} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="Change profile photo"
        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-full bg-ink-950/65 text-white opacity-0 backdrop-blur-[1px] transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/avatar:opacity-100 disabled:cursor-wait"
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
        <span className="px-1 text-center text-[0.6rem] font-semibold uppercase leading-tight tracking-wide">
          {busy ? "Uploading…" : "Change photo"}
        </span>
      </button>
      {error && (
        <p className="absolute -bottom-7 left-1/2 z-20 w-max -translate-x-1/2 rounded bg-blood-500/90 px-2 py-1 text-[0.65rem] font-semibold text-white">
          {error}
        </p>
      )}
    </div>
  );
}
