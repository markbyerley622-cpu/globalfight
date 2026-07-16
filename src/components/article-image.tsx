"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders a publisher's syndication image through the caching /api/img proxy.
 * Falls back to neutral placeholder art if there's no image or it fails to load,
 * so a broken feed image never leaves a torn card. Always paired with visible
 * source attribution + a link to the original article by the caller.
 */
export function ArticleImage({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={cn("grid place-items-center bg-ink-800 text-fog", className)}>
        <ImageIcon className="size-5" aria-hidden />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/img?u=${encodeURIComponent(src)}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
