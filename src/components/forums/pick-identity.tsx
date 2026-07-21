import { Flame } from "lucide-react";
import type { RoomIdentity } from "@/lib/community/room-types";
import { cn } from "@/lib/utils";

// The identity primitive for rooms: WHAT someone called and HOW they've done
// against you — the context a debate is unreadable without. Used on every
// battle-room message, every community-room message, and the battle banner, so
// nobody has to open a profile to know who is talking.

const METHOD_LABEL: Record<string, string> = {
  KO: "KO", TKO: "TKO", SUB: "Sub", UD: "Decision", SD: "Decision", MD: "Decision",
  DQ: "DQ", RTD: "Sub", TD: "Decision",
};
export const methodLabel = (m: string | null | undefined): string | null => (m ? METHOD_LABEL[m] ?? m : null);
export const stars = (c: number | null | undefined): string | null => (c ? "★".repeat(c) : null);

/** "Islam Makhachev · KO · ★★★★★" — the call itself. */
export function PickLine({ identity, className }: { identity: RoomIdentity; className?: string }) {
  if (!identity.fighter) {
    return <span className={cn("text-fog", className)}>Spectating · no pick</span>;
  }
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span className="font-semibold text-mist">{identity.fighter}</span>
      {methodLabel(identity.method) && <span className="text-fog">· {methodLabel(identity.method)}</span>}
      {stars(identity.confidence) && <span className="text-gold-400">{stars(identity.confidence)}</span>}
    </span>
  );
}

/** "5–2 · 🔥3" — standing against the viewer. Renders nothing when they've never met. */
export function RecordLine({ identity, className }: { identity: RoomIdentity; className?: string }) {
  const h = identity.headToHead;
  const met = h && (h.you || h.them || h.draws);
  if (!met && !identity.battleStreak) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {met && (
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[0.65rem] font-bold tabular-nums text-chalk" title="Your head-to-head record">
          {h.you}–{h.them}
          {h.draws ? `–${h.draws}` : ""}
        </span>
      )}
      {identity.battleStreak > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[0.65rem] font-bold text-blood-300" title="Battle win streak">
          <Flame className="size-3" />
          {identity.battleStreak}
        </span>
      )}
    </span>
  );
}
