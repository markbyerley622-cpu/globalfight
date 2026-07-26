import Link from "next/link";
import Image from "next/image";
import { Users, Crown, Trophy } from "lucide-react";
import type { EventRoom } from "@/lib/identity/event-room";
import { cn } from "@/lib/utils";

// ── The Room ────────────────────────────────────────────────────────────────
// How the community called the headline bout — the social complement to the
// personal ResultReveal. Every number is a straight count over the crowd's
// picks. Shown only on a completed event whose headline resolved above quorum.

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function TheRoom({ room }: { room: EventRoom }) {
  return (
    <section
      aria-label="How the room called it"
      className="border-b border-ink-700/70 px-4 py-6"
      style={{ backgroundImage: "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent, #e11d2a) 8%, transparent), transparent 70%)" }}
    >
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <Users className="size-4 text-fog" />
          <h2 className="font-display text-sm font-black uppercase tracking-[0.18em] text-chalk">The Room</h2>
          <span className="ml-auto text-[0.7rem] text-fog">{room.crowdTotal.toLocaleString()} callers</span>
        </div>

        <div className="space-y-3">
          <Bar label={`Called ${room.winnerName}`} pct={room.winnerPickedPct} tone="volt" />
          {room.finishPickedPct !== null && (
            <Bar label="Called the finish" pct={room.finishPickedPct} tone="blood" />
          )}
          <Bar label="Perfect calls (winner + method)" pct={room.perfectPct} tone="gold" />
          {room.avgConfidence !== null && (
            <Bar label="Average confidence" pct={Math.round((room.avgConfidence / 5) * 100)} tone="neutral" valueText={`${room.avgConfidence}/5`} />
          )}
        </div>

        {/* The people — the sharpest caller who nailed it, and the club that went
            perfect. Social proof grounded entirely in who actually called it. */}
        {(room.topCaller || room.perfectCount > 0) && (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {room.topCaller && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-ink-800 bg-ink-900/70 p-3">
                <span className="size-9 shrink-0 overflow-hidden rounded-full ring-1 ring-gold-500/40">
                  {room.topCaller.image ? (
                    <Image src={room.topCaller.image} alt="" width={36} height={36} className="size-full object-cover" unoptimized />
                  ) : (
                    <span className="flex size-full items-center justify-center bg-gradient-to-br from-gold-600 to-gold-800 text-[0.7rem] font-black text-white">{initials(room.topCaller.name)}</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-[0.6rem] font-bold uppercase tracking-wider text-gold-400"><Crown className="size-3" /> Top caller</p>
                  {room.topCaller.username ? (
                    <Link href={`/u/${room.topCaller.username}`} className="block truncate text-sm font-bold text-chalk hover:text-gold-200">{room.topCaller.name}</Link>
                  ) : (
                    <p className="truncate text-sm font-bold text-chalk">{room.topCaller.name}</p>
                  )}
                  <p className="text-[0.7rem] text-fog">{room.topCaller.reputation.toLocaleString()} reputation</p>
                </div>
              </div>
            )}
            {room.perfectCount > 0 && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-ink-800 bg-ink-900/70 p-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-volt-500/40 bg-volt-500/12 text-volt-300"><Trophy className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.6rem] font-bold uppercase tracking-wider text-volt-300">Perfect call club</p>
                  <p className="font-display text-lg font-black leading-none text-chalk">{room.perfectCount.toLocaleString()}</p>
                  <p className="text-[0.7rem] text-fog">called the winner and the finish</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const TONE: Record<string, string> = {
  volt: "bg-volt-400",
  blood: "bg-blood-500",
  gold: "bg-gold-400",
  neutral: "bg-ink-500",
};

function Bar({ label, pct, tone, valueText }: { label: string; pct: number; tone: keyof typeof TONE | string; valueText?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-mist">{label}</span>
        <span className="shrink-0 font-display font-black tabular-nums text-chalk">{valueText ?? `${pct}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-800">
        <div className={cn("h-full rounded-full", TONE[tone] ?? "bg-ink-500")} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}
