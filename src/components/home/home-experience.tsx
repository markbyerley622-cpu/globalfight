import { Hero, type HeroSlide } from "@/components/home/hero";
import { RankingsPreview } from "@/components/home/rankings-preview";
import { ScheduleSection } from "@/components/home/schedule-section";
import { PredictionsSection } from "@/components/home/predictions-section";
import { Spotlight } from "@/components/home/spotlight";
import { Community } from "@/components/home/community";
import { ReelsLauncher } from "@/components/home/reels-launcher";
import { PersonalizedHome } from "@/components/home/personalized-home";
import { TrackView } from "@/components/analytics-track";
import { getUpcomingEvents } from "@/lib/repo";
import { getCurrentUser } from "@/lib/auth";
import { getHomeSections } from "@/lib/home/recommendations";
import type { FightEvent } from "@/lib/types";

function buildSlides(events: FightEvent[]): HeroSlide[] {
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
  const user = await getCurrentUser();
  // Fetch upcoming events ONCE and share across the hero, personalized rails and
  // the schedule section — no duplicate work per render.
  const upcoming = await getUpcomingEvents();
  const [slides, home] = [buildSlides(upcoming), await getHomeSections(user?.id ?? null, upcoming)];
  const hasPersonal =
    home.live.length > 0 || home.continueWeek.length > 0 || home.becauseYouFollow.length > 0;
  return (
    <>
      <ReelsLauncher />
      <TrackView name="home_view" props={{ personalized: home.personalized && hasPersonal }} />
      {/* Intent-ranked, per-user rails on top; the curated global dashboard below. */}
      <PersonalizedHome data={home} />
      <Hero slides={slides} />
      <RankingsPreview />
      <ScheduleSection events={upcoming} />
      <PredictionsSection />
      <Spotlight />
      <Community />
    </>
  );
}
