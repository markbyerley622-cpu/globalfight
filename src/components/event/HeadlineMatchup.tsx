import { cn } from "@/lib/utils";
import type { Fight } from "@/lib/domain/types";
import type { SportRules } from "@/lib/domain/sportRules";
import { getAthlete } from "@/lib/data/store";
import { formatRecord } from "@/lib/domain/format";
import { FighterAvatar } from "@/components/ui/FighterAvatar";
import { Flag } from "@/components/ui/Flag";
import { Badge } from "@/components/ui/Badge";

/**
 * The headline matchup: the reason the user opened the event. Symmetric red vs
 * blue framing with records, country, ranking, division and a title indicator.
 */
export function HeadlineMatchup({ fight, rules }: { fight: Fight; rules: SportRules }) {
  const red = fight.participants.find((p) => p.corner === "red");
  const blue = fight.participants.find((p) => p.corner === "blue");
  if (!red || !blue) return null;

  const redAthlete = getAthlete(red.athleteId);
  const blueAthlete = getAthlete(blue.athleteId);

  return (
    <section className="px-4 py-5" aria-label="Headline matchup">
      <div className="mb-3 flex items-center justify-center gap-2">
        {fight.titleFight ? <Badge tone="warning">Title fight</Badge> : null}
        <Badge tone="outline">{fight.weightClass}</Badge>
        {fight.scheduledRounds ? (
          <Badge tone="outline">
            {fight.scheduledRounds} × {rules.periodNoun ?? "round"}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-stretch gap-2">
        <Corner
          name={redAthlete.name}
          nickname={redAthlete.nickname}
          record={formatRecord(redAthlete.record)}
          country={redAthlete.country}
          countryCode={redAthlete.countryCode}
          ranking={red.ranking}
          side="red"
        >
          <FighterAvatar athlete={redAthlete} size="lg" corner="red" />
        </Corner>

        <div className="flex flex-col items-center justify-center px-1">
          <span className="text-lg font-black text-faint">VS</span>
        </div>

        <Corner
          name={blueAthlete.name}
          nickname={blueAthlete.nickname}
          record={formatRecord(blueAthlete.record)}
          country={blueAthlete.country}
          countryCode={blueAthlete.countryCode}
          ranking={blue.ranking}
          side="blue"
          alignEnd
        >
          <FighterAvatar athlete={blueAthlete} size="lg" corner="blue" />
        </Corner>
      </div>
    </section>
  );
}

function Corner({
  name,
  nickname,
  record,
  country,
  countryCode,
  ranking,
  side,
  alignEnd,
  children,
}: {
  name: string;
  nickname?: string;
  record: string;
  country: string;
  countryCode: string;
  ranking?: number;
  side: "red" | "blue";
  alignEnd?: boolean;
  children: React.ReactNode;
}) {
  const rankLabel = ranking === 0 ? "Champion" : ranking ? `#${ranking}` : null;
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-2",
        alignEnd ? "items-end text-right" : "items-start text-left",
      )}
    >
      {children}
      <div className={cn(alignEnd && "flex flex-col items-end")}>
        {rankLabel ? (
          <span
            className={cn(
              "mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold",
              side === "red"
                ? "bg-[var(--color-red-corner)]/15 text-[var(--color-red-corner)]"
                : "bg-[var(--color-blue-corner)]/15 text-[var(--color-blue-corner)]",
            )}
          >
            {rankLabel}
          </span>
        ) : null}
        <p className="text-base font-bold leading-tight">{name}</p>
        {nickname ? <p className="text-xs text-muted">“{nickname}”</p> : null}
        <p className="mt-0.5 text-xs tabular-nums text-faint">{record}</p>
        <p className={cn("flex items-center gap-1 text-[11px] text-faint", alignEnd && "flex-row-reverse")}>
          <Flag code={countryCode} /> {country}
        </p>
      </div>
    </div>
  );
}
