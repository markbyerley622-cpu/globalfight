"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { STAGES, STORY_HEADING, ROUTES, type Stage } from "./content";
import { StageVisual, type StoryData } from "./story-visuals";
import { Reveal, SeenProbe } from "./reveal";

/**
 * The scroll narrative: one card, followed from announcement to result.
 *
 * ── Two renderings, one set of words ────────────────────────────────────────
 *
 *  · **stacked** — four ordinary sections. This is what the server renders, what
 *    every phone and tablet gets, and what a reader who has asked for reduced
 *    motion gets. Nothing is hidden and nothing depends on scroll position; the
 *    page is completely understandable in this mode, which is what makes the
 *    other mode safe to add.
 *  · **sticky** — a pinned stage on wide screens, crossfading across the track.
 *
 * The mode is chosen after mount, so the server HTML and the first client render
 * agree — no hydration mismatch — and only one of the two is ever in the DOM, so
 * a screen reader is never read the same four stages twice.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 * No wheel handler, no scroll locking, no snapping, no smooth-scroll
 * replacement. The component only *reads* scroll position. A reader can flick
 * past the whole thing at their own speed, which is the difference between a
 * narrative and a hostage situation.
 *
 * ── The `vh` trap ──────────────────────────────────────────────────────────
 * The app shell scrolls an inner `<main>` that is materially shorter than the
 * window — at 1440×900 the window is 900px and the scroller is roughly 670px —
 * so a track sized in `vh` would be half again as long as intended and the story
 * would feel empty. The track is sized against `--hl-vh`, the MEASURED scroller
 * height, so "1.1 screens per stage" is 1.1 screens on any shell layout.
 */

/**
 * 0.9 rather than 1.1 — measured, not guessed. At 1.1 the whole page came to
 * 9.8 scroll-screens on a laptop against a target of five to seven "meaningful
 * viewport-height moments", and the story alone was 4.4 of them. A stage needs
 * slightly less than one screen of travel to read as a deliberate beat; more
 * than that and the reader is scrolling through a stage that has already
 * finished changing.
 */
const SCREENS_PER_STAGE = 0.9;

function scrollParentOf(el: HTMLElement | null): HTMLElement | Window {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const overflowY = getComputedStyle(n).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && n.scrollHeight > n.clientHeight + 4) {
      return n;
    }
  }
  return window;
}

function StageCopy({ stage }: { stage: Stage }) {
  return (
    <>
      <span className="hl-stage-label">{stage.label}</span>
      <h3 className="hl-stage-headline">{stage.headline}</h3>
      <p className="hl-stage-support">{stage.support}</p>
    </>
  );
}

export function FightJourneyStory({ data }: { data: StoryData }) {
  const [mode, setMode] = useState<"stacked" | "sticky">("stacked");

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMode(wide.matches && !still.matches ? "sticky" : "stacked");
    apply();
    wide.addEventListener("change", apply);
    still.addEventListener("change", apply);
    return () => {
      wide.removeEventListener("change", apply);
      still.removeEventListener("change", apply);
    };
  }, []);

  return (
    <section className="hl-section hl-story" id="how-it-works" aria-labelledby="hl-story-heading">
      <h2 id="hl-story-heading" className="hl-sr">
        {STORY_HEADING}
      </h2>
      {mode === "sticky" ? <StickyStory data={data} /> : <StackedStory data={data} />}
    </section>
  );
}

/* ── Stacked ────────────────────────────────────────────────────────────────
   Four sections. No extra vertical space, no sticky dependency, every state
   visible. Identical order and identical words to the sticky rendering. */

function StackedStory({ data }: { data: StoryData }) {
  return (
    <div className="container-cr hl-story-stacked">
      {STAGES.map((stage, i) => (
        <Reveal key={stage.id} as="article" className="hl-beat">
          <SeenProbe event="home_story_stage_viewed" id={stage.id} />
          <div className="hl-beat-copy">
            <span className="hl-sr">{`Stage ${i + 1} of ${STAGES.length}`}</span>
            <StageCopy stage={stage} />
            <StageLink stage={stage} />
          </div>
          <StageVisual stage={stage} data={data} />
        </Reveal>
      ))}
    </div>
  );
}

/* ── Sticky ─────────────────────────────────────────────────────────────────
   A pinned stage, crossfading. The copy for all four stages is in the DOM at
   once and only the visible one is opaque, so nothing has to be inserted or
   removed mid-scroll — which is what makes the transition free of layout work. */

function StickyStory({ data }: { data: StoryData }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const scroller = scrollParentOf(track);

    // The measured scroller height, published as a CSS variable so the track
    // length and the pinned stage agree on what "one screen" means.
    const setVh = () => {
      const h = scroller instanceof Window ? window.innerHeight : scroller.clientHeight;
      track.style.setProperty("--hl-vh", `${h}px`);
    };

    let frame = 0;
    const read = () => {
      frame = 0;
      const rect = track.getBoundingClientRect();
      const viewport = scroller instanceof Window ? window.innerHeight : scroller.clientHeight;
      // Progress over the TRAVEL — the distance the track actually moves past the
      // viewport — not over its full height. Using the height overshoots by one
      // screen and the last stage never gets its turn.
      const travel = track.offsetHeight - viewport;
      if (travel <= 0) return;
      const p = Math.min(1, Math.max(0, -rect.top / travel));
      setProgress(p);
      setActive(Math.min(STAGES.length - 1, Math.floor(p * STAGES.length)));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(read);
    };

    setVh();
    read();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", setVh);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", setVh);
    };
  }, []);

  return (
    <div
      ref={trackRef}
      className="hl-track"
      // `--hl-vh` has a CSS default (see home-landing.css) that is already
      // correct to within a pixel or two; the effect below replaces it with the
      // exact measurement. Both renderings size from the same variable, so the
      // swap costs no layout shift.
      style={{ blockSize: `calc(var(--hl-vh) * ${STAGES.length * SCREENS_PER_STAGE})` }}
    >
      <div className="hl-pin">
        <div className="container-cr hl-pin-grid">
          <div className="hl-pin-copy">
            {/* The card being followed, named once and held for all four stages.
                Without it the pinned column is a headline floating in half a
                screen of black, and — more importantly — the reader has to infer
                that every stage is showing them the SAME event, which is the
                entire argument the section is making. */}
            <p className="hl-pin-subject">
              <span className="hl-pin-subject-label">Following one card</span>
              <span className="hl-pin-subject-name">
                {data.event.placeholder ? "An upcoming event" : data.event.name}
              </span>
            </p>

            {/* One progress indicator for the whole story, so a reader can see
                how much of it is left before committing to the scroll. */}
            <ol className="hl-progress" aria-hidden="true">
              {STAGES.map((s, i) => (
                <li key={s.id} data-state={i === active ? "active" : i < active ? "done" : "todo"}>
                  <span
                    className="hl-progress-fill"
                    style={i === active ? { transform: `scaleX(${(progress * STAGES.length) % 1})` } : undefined}
                  />
                </li>
              ))}
            </ol>

            <div className="hl-pin-stack">
              {STAGES.map((stage, i) => (
                <div key={stage.id} className="hl-pin-beat" data-active={i === active ? "true" : "false"}>
                  {i === active && <SeenProbe event="home_story_stage_viewed" id={stage.id} />}
                  <StageCopy stage={stage} />
                  <StageLink stage={stage} />
                </div>
              ))}
            </div>
          </div>

          <div className="hl-pin-visual">
            {STAGES.map((stage, i) => (
              <div key={stage.id} className="hl-pin-vis" data-active={i === active ? "true" : "false"}>
                <StageVisual stage={stage} data={data} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── The way out of every stage ─────────────────────────────────────────────
   Each stage names the real route where the thing it describes actually works.
   This is what keeps the visuals honest: the picture is a picture, and the link
   beside it is the product. */

const STAGE_LINK: Record<Stage["id"], { href: string; label: string }> = {
  discover: { href: ROUTES.events, label: "Browse events" },
  card: { href: ROUTES.events, label: "Open a fight card" },
  pick: { href: ROUTES.leaderboard, label: "See the leaderboard" },
  follow: { href: ROUTES.results, label: "See results" },
};

function StageLink({ stage }: { stage: Stage }) {
  const link = STAGE_LINK[stage.id];
  return (
    <Link href={link.href} className="hl-stage-link">
      {link.label}
    </Link>
  );
}
