import Image from "next/image";
import { cn } from "@/lib/utils";
import { Flag } from "@/components/flag";
import { safeFighterImageOrNull } from "@/lib/media-safe";
import type { Fighter } from "@/lib/types";

// Combat Reviews brand avatar: a black circle with a red perimeter. A photo (when
// present) sits inside the red ring; otherwise the initials render in red on
// black. One consistent brand look — no per-fighter identity colours.

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}

const sizeMap = {
  sm: "size-10 text-sm border-2",
  md: "size-14 text-lg border-2",
  lg: "size-20 text-2xl border-[3px]",
  xl: "size-32 text-4xl border-4",
} as const;

export function FighterAvatar({
  fighter, size = "md", className, showFlag = false,
}: {
  fighter: Pick<Fighter, "name" | "imageUrl" | "thumbUrl" | "countryCode">;
  size?: keyof typeof sizeMap;
  className?: string;
  showFlag?: boolean;
}) {
  const big = size === "lg" || size === "xl";
  const raw = big ? fighter.imageUrl ?? fighter.thumbUrl : fighter.thumbUrl ?? fighter.imageUrl;
  // Refuses any /fighters/** path (the deleted unlicensed corpus) and any remote host
  // that isn't our own storage. Falls through to the initials mark below.
  const src = safeFighterImageOrNull(raw);
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full border-blood-500 bg-ink-950 font-display font-bold text-blood-500 shadow-[0_0_14px_-3px_rgba(225,29,42,0.55)]",
          sizeMap[size],
        )}
      >
        {src ? (
          // Licensed photos served via the /api/img proxy bypass the optimizer
          // (next.config remotePatterns only allow our own storage) — same as
          // the news covers. Own-storage images still get optimized.
          <Image
            src={src}
            alt={fighter.name}
            fill
            className="object-cover object-top"
            sizes="128px"
            unoptimized={src.startsWith("/api/img")}
          />
        ) : (
          <span className="relative tracking-tight">{initials(fighter.name)}</span>
        )}
      </div>
      {showFlag && fighter.countryCode && (
        <span className="absolute -bottom-1 -right-1 overflow-hidden rounded-[3px] bg-ink-900 ring-2 ring-ink-900">
          <Flag code={fighter.countryCode} size="sm" />
        </span>
      )}
    </div>
  );
}
