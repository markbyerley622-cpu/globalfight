import { Hero, type HeroSlide } from "@/components/home/hero";
import { RankingsPreview } from "@/components/home/rankings-preview";
import { ScheduleSection } from "@/components/home/schedule-section";
import { PredictionsSection } from "@/components/home/predictions-section";
import { Spotlight } from "@/components/home/spotlight";
import { Community } from "@/components/home/community";
import { ReelsLauncher } from "@/components/home/reels-launcher";
import { getUpcomingEvents } from "@/lib/repo";

async function buildSlides(): Promise<HeroSlide[]> {
  const events = await getUpcomingEvents();
  return events.slice(0, 3).map((e) => {
    const main = e.fights.find((f) => f.mainEvent) ?? e.fights[0];
    if (!main) return null; // event with no fights — skip rather than build a broken slide
    return {
      kind: "FIGHT",
      tag: main.titleFight ? "Championship" : "Upcoming Fight",
      eventName: e.name,
      href: `/predictions/${main.slug}`,
      date: e.date,
      venue: e.venue,
      country: e.country,
      countryCode: e.countryCode,
      broadcaster: e.broadcaster,
      red: main.red,
      blue: main.blue,
      redProbability: main.prediction?.redProbability,
      excerpt: [
        e.promotion ? `${e.promotion} presents ${e.name}` : e.name,
        [e.venue, e.city, e.country].filter(Boolean).join(", "),
      ].filter(Boolean).join(" — live from ") + ".",
    } as HeroSlide;
  }).filter((s): s is HeroSlide => s !== null);
}

/**
 * The "Intelligence Layer" landing — the curated dashboard used by both the
 * Feed route (/) and /home: hero + rankings + schedule + predictions +
 * spotlight + community, wrapped in the official sponsor marquees.
 */
export async function HomeExperience() {
  const slides = await buildSlides();
  return (
    <>
      <ReelsLauncher />
      <Hero slides={slides} />
      <RankingsPreview />
      <ScheduleSection />
      <PredictionsSection />
      <Spotlight />
      <Community />
    </>
  );
}
