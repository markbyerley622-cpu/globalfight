import { Swords } from "lucide-react";
import type { Fight, Sport } from "@/lib/domain/types";
import type { SportRules } from "@/lib/domain/sportRules";
import { groupFightsBySegment } from "@/lib/domain/selectors";
import { EmptyState } from "@/components/ui/EmptyState";
import { FightCardSection } from "./FightCardSection";

/**
 * The full fight card: every scheduled contest grouped into ordered segments.
 * Terminology (bout/match/fight, round/period) comes from the sport's rules.
 */
export function FightCard({
  fights,
  rules,
  sport,
  eventSlug,
}: {
  fights: Fight[];
  rules: SportRules;
  sport: Sport;
  eventSlug: string;
}) {
  const sections = groupFightsBySegment(fights);

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={<Swords className="h-6 w-6" />}
        title="Card not announced"
        description={`The ${rules.contestNounPlural.toLowerCase()} for this event haven't been confirmed yet. They'll appear here as they're booked.`}
        tone="unavailable"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <FightCardSection
          key={section.segment}
          label={section.label}
          fights={section.fights}
          rules={rules}
          sport={sport}
          eventSlug={eventSlug}
        />
      ))}
    </div>
  );
}
