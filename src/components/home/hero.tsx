"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Calendar, MapPin, Tv, Newspaper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FighterAvatar } from "@/components/fighter-avatar";
import { Countdown } from "@/components/countdown";
import { ProbabilityBar } from "@/components/probability-bar";
import { Flag } from "@/components/flag";
import { formatRecord } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Fighter } from "@/lib/types";
import { safeNewsCover } from "@/lib/media-safe";

export type HeroSlide = {
  kind: "FIGHT" | "NEWS";
  tag: string;
  eventName: string;
  href: string;
  date?: string;
  venue?: string;
  country?: string;
  countryCode?: string;
  broadcaster?: string;
  red?: Fighter;
  blue?: Fighter;
  redProbability?: number;
  headline?: string;
  excerpt?: string;
  coverImageUrl?: string;
};

export function Hero({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;

  const go = useCallback((dir: number) => setIndex((i) => (i + dir + n) % n), [n]);

  useEffect(() => {
    if (paused || n <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % n), 7000);
    return () => clearInterval(id);
  }, [paused, n]);

  // No slides (no upcoming events yet, or the data layer is unavailable) — show a
  // calm placeholder instead of crashing on slides[index].tag. Hooks above run
  // unconditionally, so this early return is Rules-of-Hooks safe.
  if (n === 0) {
    return (
      <section className="relative overflow-hidden border-b border-ink-800">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <div className="absolute -left-40 top-0 size-[36rem] rounded-full bg-blood-700/20 blur-[120px]" />
        <div className="absolute inset-0 vignette" />
        <div className="container-cr relative py-16 sm:py-24">
          <span className="eyebrow">The Intelligence Layer of Combat Sports</span>
          <h1 className="mt-3 max-w-2xl font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight text-chalk text-balance sm:text-5xl">
            No fights on the card right now
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-mist sm:text-base">
            The schedule is quiet — check back soon, or browse the full calendar.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/schedule" size="lg">Full Schedule</ButtonLink>
            <ButtonLink href="/rankings" variant="outline" size="lg">Rankings</ButtonLink>
          </div>
        </div>
      </section>
    );
  }

  // Clamp in case the slide set shrank below the current index between renders.
  const slide = slides[Math.min(index, n - 1)];

  return (
    <section
      className="relative overflow-hidden border-b border-ink-800"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Background flourish */}
      <div className="absolute inset-0 bg-grid opacity-60" />
      <div className="absolute -left-40 top-0 size-[36rem] rounded-full bg-blood-700/20 blur-[120px]" />
      <div className="absolute -right-40 bottom-0 size-[34rem] rounded-full bg-volt-500/10 blur-[120px]" />
      <div className="absolute inset-0 vignette" />

      <div className="container-cr relative py-10 sm:py-14 lg:py-20">
        <div className="mb-8 max-w-2xl">
          <span className="eyebrow">The Intelligence Layer of Combat Sports</span>
          <p className="mt-1 font-display text-lg font-medium uppercase tracking-wide text-mist">
            No fluff — just pure fight knowledge.
          </p>
        </div>
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          {/* Left: copy */}
          <div key={`copy-${index}`} className="animate-[fadeIn_.5s_ease]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="red">{slide.tag}</Badge>
              {slide.broadcaster && (
                <Badge tone="neutral"><Tv className="size-3" />{slide.broadcaster}</Badge>
              )}
            </div>

            <h1 className="mt-4 font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight text-chalk text-balance sm:text-5xl lg:text-6xl xl:text-7xl">
              {slide.kind === "FIGHT" && slide.red && slide.blue ? (
                <>
                  {slide.red.name}
                  <span className="mx-2 text-blood-500">vs</span>
                  {slide.blue.name}
                </>
              ) : (
                slide.headline
              )}
            </h1>

            <p className="mt-4 max-w-lg text-sm leading-relaxed text-mist sm:text-base">
              {slide.excerpt ?? slide.eventName}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-mist">
              {slide.date && (
                <span className="flex items-center gap-1.5"><Calendar className="size-4 text-blood-400" />{new Date(slide.date).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" })}</span>
              )}
              {slide.venue && (
                <span className="flex items-center gap-1.5"><MapPin className="size-4 text-blood-400" />{slide.venue}{slide.country ? `, ${slide.country}` : ""} <Flag code={slide.countryCode} /></span>
              )}
            </div>

            {slide.date && (
              <div className="mt-6 rounded-xl border border-ink-700 bg-ink-900/60 p-4 backdrop-blur">
                <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-fog">Countdown to first bell</p>
                <Countdown date={slide.date} />
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href={slide.href} size="lg">
                {slide.kind === "FIGHT" ? "Fight Breakdown" : "Read Story"}
              </ButtonLink>
              <ButtonLink href="/schedule" variant="outline" size="lg">Full Schedule</ButtonLink>
            </div>
          </div>

          {/* Right: matchup visual */}
          <div key={`viz-${index}`} className="animate-[fadeIn_.6s_ease]">
            {slide.kind === "FIGHT" && slide.red && slide.blue ? (
              <div className="card-surface relative overflow-hidden p-6">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blood-500 via-gold-500 to-volt-500" />
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <FighterAvatar fighter={slide.red} size="xl" showFlag />
                    <div>
                      <p className="font-display text-base font-bold text-chalk">{slide.red.name}</p>
                      <p className="text-xs text-fog">{formatRecord(slide.red.wins, slide.red.losses, slide.red.draws)}</p>
                    </div>
                  </div>
                  <div className="flex size-12 items-center justify-center rounded-full bg-blood-500 font-display text-lg font-black text-white shadow-glow-red">VS</div>
                  <div className="flex flex-col items-center gap-3 text-center">
                    <FighterAvatar fighter={slide.blue} size="xl" showFlag />
                    <div>
                      <p className="font-display text-base font-bold text-chalk">{slide.blue.name}</p>
                      <p className="text-xs text-fog">{formatRecord(slide.blue.wins, slide.blue.losses, slide.blue.draws)}</p>
                    </div>
                  </div>
                </div>
                {typeof slide.redProbability === "number" && (
                  <div className="mt-6">
                    <p className="mb-2 text-center text-[0.65rem] font-semibold uppercase tracking-widest text-fog">Win Probability</p>
                    <ProbabilityBar redLabel={slide.red.name} blueLabel={slide.blue.name} redProbability={slide.redProbability} />
                  </div>
                )}
              </div>
            ) : (
              <div className="card-surface relative flex aspect-[4/3] items-end justify-start overflow-hidden p-6">
                {(
                  <div className="absolute inset-0 bg-cover bg-center opacity-70" style={{ backgroundImage: `url(${safeNewsCover(slide.headline ?? slide.eventName, slide.coverImageUrl)})` }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/60 to-ink-950/10" />
                <div className="absolute inset-0 bg-grid opacity-15" />
                <div className="absolute -right-10 -top-10 size-48 rounded-full bg-blood-700/20 blur-3xl" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/cr-logo.png" alt="Combat Reviews" className="absolute right-5 top-5 h-9 w-auto opacity-60" />
                <span className="relative inline-flex items-center gap-2 rounded-lg bg-ink-950/60 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-chalk backdrop-blur">
                  <Newspaper className="size-4 text-blood-400" /> Breaking
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="mt-8 flex items-center justify-between">
          <div className="flex gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-8 bg-blood-500" : "w-3 bg-ink-600 hover:bg-ink-500",
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => go(-1)} className="rounded-lg border border-ink-700 p-2 text-mist hover:border-ink-600 hover:text-chalk" aria-label="Previous slide">
              <ChevronLeft className="size-5" />
            </button>
            <button onClick={() => go(1)} className="rounded-lg border border-ink-700 p-2 text-mist hover:border-ink-600 hover:text-chalk" aria-label="Next slide">
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
