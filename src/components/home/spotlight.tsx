import { Ruler, Hand, MapPin, Swords } from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FighterAvatar } from "@/components/fighter-avatar";
import { Flag } from "@/components/flag";
import { getFighter } from "@/lib/repo";
import { ageFrom, koPercentage, formatRecord } from "@/lib/utils";

export async function Spotlight() {
  const fighter = await getFighter("naoya-inoue");
  if (!fighter) return null;

  const ko = koPercentage(fighter.koWins, fighter.wins);
  const stats = [
    { icon: Swords, label: "Record", value: formatRecord(fighter.wins, fighter.losses, fighter.draws) },
    { icon: Ruler, label: "Height", value: fighter.heightCm ? `${(fighter.heightCm / 2.54 / 12 | 0)}'${Math.round((fighter.heightCm / 2.54) % 12)}"` : "—" },
    { icon: Hand, label: "Stance", value: fighter.stance ?? "—" },
    { icon: MapPin, label: "From", value: fighter.nationality ?? "—" },
  ];

  return (
    <section className="container-cr py-12">
      <SectionHeading eyebrow="Fighter of the Week" title="Spotlight" href={`/fighters/${fighter.slug}`} hrefLabel="Full profile" />
      <div className="card-surface relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute -right-20 -top-20 size-80 rounded-full bg-gold-500/10 blur-[100px]" />
        <div className="relative grid gap-6 p-6 lg:grid-cols-[auto_1fr] lg:p-8">
          <div className="flex flex-col items-center gap-4 lg:items-start">
            <FighterAvatar fighter={fighter} size="xl" showFlag className="scale-110" />
            <div className="text-center lg:text-left">
              {fighter.nickname && <Badge tone="gold">“{fighter.nickname}”</Badge>}
              <h3 className="mt-2 flex items-center justify-center gap-2 font-display text-3xl font-bold text-chalk lg:justify-start"><Flag code={fighter.countryCode} size="lg" /> {fighter.name}</h3>
              <p className="text-sm text-fog">{ageFrom(fighter.birthDate)} years old · {fighter.nationality}</p>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-6">
            <p className="max-w-2xl text-sm leading-relaxed text-mist">{fighter.bio}</p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-lg border border-ink-700 bg-ink-950/40 p-3">
                  <s.icon className="mb-1.5 size-4 text-blood-400" />
                  <p className="text-[0.65rem] uppercase tracking-wider text-fog">{s.label}</p>
                  <p className="font-display text-base font-bold text-chalk">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-wide text-mist">KO Ratio</span>
                  <span className="font-display font-bold text-gold-400">{ko}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink-700">
                  <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400" style={{ width: `${ko}%` }} />
                </div>
              </div>
              <ButtonLink href={`/fighters/${fighter.slug}`} variant="gold">View Career</ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
