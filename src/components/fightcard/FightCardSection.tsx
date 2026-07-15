import type { Fight, Sport } from "@/lib/domain/types";
import type { SportRules } from "@/lib/domain/sportRules";
import { FightRow } from "./FightRow";

/**
 * A labelled segment of the card (Main event, Main card, Prelims, Early prelims).
 */
export function FightCardSection({
  label,
  fights,
  rules,
  sport,
  eventSlug,
}: {
  label: string;
  fights: Fight[];
  rules: SportRules;
  sport: Sport;
  eventSlug: string;
}) {
  return (
    <section aria-label={label}>
      <h3 className="eyebrow mb-2">{label}</h3>
      <div className="flex flex-col gap-2">
        {fights.map((fight) => (
          <FightRow
            key={fight.id}
            fight={fight}
            rules={rules}
            href={`/sports/${sport.slug}/events/${eventSlug}/fights/${fight.slug}`}
          />
        ))}
      </div>
    </section>
  );
}
