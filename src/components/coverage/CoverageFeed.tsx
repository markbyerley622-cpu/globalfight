import { Newspaper } from "lucide-react";
import type { Article, Fight } from "@/lib/domain/types";
import { getAthlete } from "@/lib/data/store";
import { EmptyState } from "@/components/ui/EmptyState";
import { CoverageCard } from "./CoverageCard";

/**
 * Event-specific coverage feed. Only shows articles attached to THIS event — no
 * generic article dump. Articles scoped to a bout are tagged with the matchup.
 */
export function CoverageFeed({ articles, fights }: { articles: Article[]; fights: Fight[] }) {
  if (articles.length === 0) {
    return (
      <EmptyState
        icon={<Newspaper className="h-6 w-6" />}
        title="No coverage yet"
        description="Previews, breakdowns and reports for this event will appear here as they're published."
      />
    );
  }

  const fightById = new Map(fights.map((f) => [f.id, f]));
  const boutTag = (fight?: Fight) => {
    if (!fight) return undefined;
    const red = fight.participants.find((p) => p.corner === "red");
    const blue = fight.participants.find((p) => p.corner === "blue");
    if (!red || !blue) return undefined;
    return `${getAthlete(red.athleteId).name.split(" ").pop()} vs ${getAthlete(blue.athleteId).name.split(" ").pop()}`;
  };

  return (
    <div className="flex flex-col gap-3">
      {articles.map((article) => (
        <CoverageCard
          key={article.id}
          article={article}
          boutTag={article.fightId ? boutTag(fightById.get(article.fightId)) : undefined}
        />
      ))}
    </div>
  );
}
