import Link from "next/link";
import type { WeightClassRanking } from "@/lib/types";
import { FighterAvatar } from "./fighter-avatar";
import { MovementIndicator } from "./ui/badge";
import { Flag } from "./flag";
import { formatRecord } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { SPORT_LABEL } from "@/lib/sports";

export function RankingList({
  ranking, limit, showRating = true, dense = false, showSport = false,
}: {
  ranking: WeightClassRanking;
  limit?: number;
  showRating?: boolean;
  dense?: boolean;
  showSport?: boolean;   // show each fighter's sport (for mixed P4P / all-sports lists)
}) {
  const rows = limit ? ranking.rankings.slice(0, limit) : ranking.rankings;
  return (
    <ul className="divide-y divide-ink-800">
      {rows.map((r) => {
        const champ = r.rank === 1;
        return (
          <li key={r.fighter.slug}>
            <Link
              href={`/fighters/${r.fighter.slug}`}
              className={cn(
                "flex items-center gap-3 transition-colors hover:bg-ink-800/60",
                dense ? "px-3 py-2" : "px-3 py-2.5",
              )}
            >
              <span
                className={cn(
                  "flex w-7 shrink-0 justify-center font-display text-lg font-bold tabular-nums",
                  champ ? "text-gold-400" : "text-fog",
                )}
              >
                {r.rank}
              </span>
              <div className="flex w-8 justify-center"><MovementIndicator movement={r.movement} /></div>
              <FighterAvatar fighter={r.fighter} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate font-display text-sm font-semibold text-chalk">
                  <Flag code={r.fighter.countryCode} /> {r.fighter.name}
                </p>
                <p className="flex items-center gap-1.5 truncate text-xs text-fog">
                  {showSport && <span className="font-semibold uppercase tracking-wide text-blood-400">{SPORT_LABEL[r.fighter.sport] ?? r.fighter.sport}</span>}
                  <span>
                    {[formatRecord(r.fighter.wins, r.fighter.losses, r.fighter.draws), r.fighter.koWins ? `${r.fighter.koWins} KO` : ""].filter(Boolean).join(" · ")}
                  </span>
                </p>
              </div>
              {showRating && r.rating != null && (
                <span className="shrink-0 font-display text-sm font-bold tabular-nums text-mist">
                  {r.rating.toFixed(1)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
