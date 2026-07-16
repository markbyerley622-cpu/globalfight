import { cn } from "@/lib/utils";

// Win/Loss/Draw donut — pure SVG, no client JS.
export function RecordDonut({
  wins, losses, draws, size = 160,
}: { wins: number; losses: number; draws: number; size?: number }) {
  const total = Math.max(1, wins + losses + draws);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const segs = [
    { v: wins, color: "var(--color-up)" },
    { v: losses, color: "var(--color-down)" },
    { v: draws, color: "var(--color-fog)" },
  ];
  let offset = 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth={12} />
        {segs.map((s, i) => {
          const len = (s.v / total) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={s.color} strokeWidth={12}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl font-black text-chalk">{wins}-{losses}-{draws}</span>
        <span className="text-[0.65rem] uppercase tracking-widest text-fog">Pro Record</span>
      </div>
    </div>
  );
}

// Horizontal stat bar (KO ratio, decision ratio, etc.)
export function StatBar({
  label, value, max = 100, suffix = "%", tone = "red",
}: { label: string; value: number; max?: number; suffix?: string; tone?: "red" | "gold" | "volt" }) {
  const pct = Math.min(100, (value / max) * 100);
  const tones = {
    red: "from-blood-600 to-blood-400",
    gold: "from-gold-600 to-gold-400",
    volt: "from-volt-500 to-volt-400",
  } as const;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-mist">{label}</span>
        <span className="font-display font-bold text-chalk">{value}{suffix}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-700">
        <div className={cn("h-full rounded-full bg-gradient-to-r", tones[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Simple activity sparkline (fights per year), pure SVG.
export function ActivityBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1.5">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-20 w-full items-end">
            <div
              className="w-full rounded-t bg-gradient-to-t from-blood-700 to-blood-400 transition-all"
              style={{ height: `${(d.value / max) * 100}%` }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
          <span className="text-[0.6rem] text-fog">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
