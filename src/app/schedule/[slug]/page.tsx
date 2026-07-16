import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, Tv, Calendar, Building } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { FightCard } from "@/components/fight-card";
import { getEvent, getUpcomingEvents } from "@/lib/repo";
import { Flag } from "@/components/flag";
import { formatDate } from "@/lib/utils";

export async function generateStaticParams() {
  return (await getUpcomingEvents()).map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const e = await getEvent(slug);
  if (!e) return {};
  return { title: e.name, description: `${e.name} — full fight card, venue, broadcast and predictions. ${e.venue}, ${e.city}.` };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await getEvent(slug);
  if (!e) notFound();

  const locParts = [e.city, e.country].filter(Boolean);
  const meta = [
    { icon: Calendar, label: "Date", value: formatDate(e.date, { weekday: "long" }) },
    { icon: Building, label: "Venue", value: e.venue ?? "TBA" },
    {
      icon: MapPin, label: "Location",
      value: locParts.length
        ? <span className="flex items-center gap-1.5">{locParts.join(", ")} <Flag code={e.countryCode} /></span>
        : "TBA",
    },
    { icon: Tv, label: "Broadcast", value: e.broadcaster ?? "TBA" },
  ];

  return (
    <>
      <PageHero eyebrow={e.promotion ?? "Fight Card"} title={e.name}>
        <div className="flex flex-wrap items-center gap-4">
          <Badge tone={e.status === "COMPLETED" ? "neutral" : "red"}>{e.status}</Badge>
          {e.status !== "COMPLETED" && (
            <div className="rounded-lg border border-ink-700 bg-ink-950/40 px-4 py-2">
              <Countdown date={e.date} compact />
            </div>
          )}
        </div>
      </PageHero>

      <div className="container-cr py-10">
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {meta.map((m) => (
            <div key={m.label} className="card-surface p-4">
              <m.icon className="mb-1.5 size-4 text-blood-400" />
              <p className="text-[0.6rem] uppercase tracking-wider text-fog">{m.label}</p>
              <p className="font-display text-sm font-bold text-chalk">{m.value}</p>
            </div>
          ))}
        </div>

        <h2 className="mb-4 font-display text-2xl font-bold uppercase text-chalk">Fight Card</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {e.fights.map((f) => <FightCard key={f.id} fight={f} />)}
        </div>
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
