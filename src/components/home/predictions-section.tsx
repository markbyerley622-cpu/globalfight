import { SectionHeading } from "@/components/section-heading";
import { FightCard } from "@/components/fight-card";
import { getFeaturedPredictions } from "@/lib/repo";

export async function PredictionsSection() {
  const fights = (await getFeaturedPredictions()).slice(0, 3);

  return (
    <section className="container-cr py-12">
      <SectionHeading eyebrow="Powered by the CR model" title="Fight Predictions" href="/predictions" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {fights.map((f) => (
          <FightCard key={f.id} fight={f} />
        ))}
      </div>
    </section>
  );
}
