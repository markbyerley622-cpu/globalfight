import Link from "next/link";
import { Flag } from "@/components/flag";
import { formatRecord, koPercentage } from "@/lib/utils";
import { cn } from "@/lib/utils";

// The tale of the tape — the oldest, most-searched combat-sports comparison
// there is, and the reason a matchup page earns traffic. Every row is derived
// from data already on the fighter rows (no extra query). A row is omitted
// entirely when NEITHER side has the value, so the table never shows a column
// of dashes for sports that don't record it.

export interface TapeFighter {
  slug: string;
  name: string;
  nickname: string | null;
  countryCode: string | null;
  nationality: string | null;
  wins: number; losses: number; draws: number;
  koWins: number; koLosses: number;
  heightCm: number | null;
  reachCm: number | null;
  stance: string | null;
  gym: string | null;
  birthDate: Date | null;
}

const cm = (v: number | null) => (v ? `${v} cm` : null);
const age = (d: Date | null) => {
  if (!d) return null;
  const ms = Date.now() - d.getTime();
  return `${Math.floor(ms / 31_557_600_000)}`;
};
const title = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : null);

export function TaleOfTape({ red, blue }: { red: TapeFighter; blue: TapeFighter }) {
  const rows: { label: string; r: string | null; b: string | null }[] = [
    { label: "Record", r: formatRecord(red.wins, red.losses, red.draws), b: formatRecord(blue.wins, blue.losses, blue.draws) },
    { label: "KO rate", r: red.wins ? `${koPercentage(red.koWins, red.wins)}%` : null, b: blue.wins ? `${koPercentage(blue.koWins, blue.wins)}%` : null },
    { label: "Age", r: age(red.birthDate), b: age(blue.birthDate) },
    { label: "Height", r: cm(red.heightCm), b: cm(blue.heightCm) },
    { label: "Reach", r: cm(red.reachCm), b: cm(blue.reachCm) },
    { label: "Stance", r: title(red.stance), b: title(blue.stance) },
    { label: "Gym", r: red.gym, b: blue.gym },
    { label: "Nationality", r: red.nationality, b: blue.nationality },
  ].filter((row) => row.r || row.b);

  return (
    <div className="card-surface overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 border-b border-ink-700/70 p-4">
        <Corner f={red} tone="red" />
        <span className="pt-1 font-display text-sm font-black text-fog">VS</span>
        <Corner f={blue} tone="blue" alignEnd />
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Tale of the tape: {red.name} versus {blue.name}</caption>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.label} className={cn(i % 2 === 1 && "bg-ink-950/30")}>
              <td className="w-[38%] px-3 py-2 text-left font-semibold tabular-nums text-chalk">{row.r ?? "—"}</td>
              <th scope="row" className="px-2 py-2 text-center text-[0.65rem] font-medium uppercase tracking-wider text-fog">
                {row.label}
              </th>
              <td className="w-[38%] px-3 py-2 text-right font-semibold tabular-nums text-chalk">{row.b ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Corner({ f, tone, alignEnd }: { f: TapeFighter; tone: "red" | "blue"; alignEnd?: boolean }) {
  return (
    <div className={cn("min-w-0", alignEnd && "text-right")}>
      <span className={cn("text-[0.6rem] font-bold uppercase tracking-wider", tone === "red" ? "text-blood-400" : "text-volt-400")}>
        {tone === "red" ? "Red corner" : "Blue corner"}
      </span>
      <Link href={`/fighters/${f.slug}`} className="mt-0.5 block truncate font-display text-base font-bold leading-tight text-chalk hover:text-blood-300 hover:underline">
        {f.name}
      </Link>
      {f.nickname && <p className="truncate text-xs italic text-fog">&ldquo;{f.nickname}&rdquo;</p>}
      <p className={cn("mt-1 flex items-center gap-1.5 text-xs text-mist", alignEnd && "justify-end")}>
        <Flag code={f.countryCode} />
        {formatRecord(f.wins, f.losses, f.draws)}
      </p>
    </div>
  );
}
