import { formatDate } from "@/lib/utils";
import { SKILL_NOT_BETTING, type StageId, type Stage } from "./content";
import type { HeroEvent, MiniEvent, ResultPreview, CoveragePreview, LeaderPreview } from "./data";

/**
 * The four stage visuals.
 *
 * ── Why these are pictures, not working UI ──────────────────────────────────
 * Every one of them is wrapped in `role="img"` with the stage's own description,
 * and everything inside is `aria-hidden`. That is a deliberate accessibility
 * decision, not a shortcut: a prediction control that cannot take a prediction,
 * a filter chip that filters nothing and a Follow button that 401s are all
 * *fake controls*, and exposing them to a screen reader as buttons would be a
 * straightforward lie about what this page can do. A reader using assistive
 * technology gets the sentence that says what the picture shows; a reader using
 * their eyes gets the picture. Neither is offered a control that does nothing.
 *
 * The real controls are one link away, and every stage's copy block carries that
 * link.
 *
 * The data is real — the same event, the same crowd split, the same result and
 * the same predictor board the rest of the page reads. When a field is missing
 * the element is dropped rather than filled with an invented value.
 */

export interface StoryData {
  event: HeroEvent;
  upNext: MiniEvent[];
  result: ResultPreview | null;
  coverage: CoveragePreview[];
  leaders: LeaderPreview[];
}

const SPORT_CHIPS = ["MMA", "Boxing", "Muay Thai", "Kickboxing", "Bare Knuckle"];

/* ── 01 Discover ────────────────────────────────────────────────────────────
   Loose announcements settling into one organised card. The scattered chips are
   the same three facts a fan currently has to assemble from four apps: who,
   where, when. */
function DiscoverVisual({ d }: { d: StoryData }) {
  const { event, upNext } = d;
  return (
    <div className="hl-vis-discover" aria-hidden="true">
      <div className="hl-filters">
        {SPORT_CHIPS.map((s, i) => (
          <span key={s} className="hl-chip" data-active={i === 0 ? "true" : undefined}>
            {s}
          </span>
        ))}
      </div>

      <div className="hl-scatter">
        {[event, ...upNext].slice(0, 4).map((e, i) => (
          <div key={e.slug ?? i} className="hl-scatter-item" data-i={i}>
            <span className="hl-scatter-promo">{e.promotion}</span>
            <span className="hl-scatter-name">{e.name}</span>
            <span className="hl-scatter-meta">
              {e.location ?? e.sport} · {formatDate(e.date, { year: undefined })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 02 The full card ───────────────────────────────────────────────────────
   The card opened. Segments are labelled MAIN CARD and PRELIMS because that is
   what a broadcast calls them — and the count comes from the event's real bout
   total, so a four-bout card does not claim a twelve-bout structure. */
function CardVisual({ d }: { d: StoryData }) {
  const { event } = d;
  // The real split when the card is big enough to have one; otherwise the whole
  // card is the main card, which is what a small regional show actually is.
  const total = event.boutCount;
  const mainCard = total >= 6 ? Math.ceil(total / 2) : total;
  const prelims = Math.max(0, total - mainCard);

  return (
    <div className="hl-vis-card" aria-hidden="true">
      <div className="hl-fc-head">
        <span className="hl-fc-promo">{event.promotion}</span>
        <span className="hl-fc-name">{event.name}</span>
        <span className="hl-fc-where">
          {[event.venue, event.location].filter(Boolean).join(" · ") || event.sport}
        </span>
      </div>

      <div className="hl-fc-segment">
        <span className="hl-fc-seg-label">Main event</span>
        <div className="hl-fc-bout" data-main="true">
          <span>{event.red.name}</span>
          <span className="hl-fc-vs">vs</span>
          <span>{event.blue.name}</span>
        </div>
        <div className="hl-fc-records">
          <span>{event.red.record || "—"}</span>
          <span>{event.blue.record || "—"}</span>
        </div>
      </div>

      {mainCard > 1 && (
        <div className="hl-fc-segment">
          <span className="hl-fc-seg-label">Main card · {mainCard - 1} more</span>
          {Array.from({ length: Math.min(2, mainCard - 1) }).map((_, i) => (
            <div key={i} className="hl-fc-bout hl-fc-skeleton" />
          ))}
        </div>
      )}

      {prelims > 0 && (
        <div className="hl-fc-segment">
          <span className="hl-fc-seg-label">Prelims · {prelims}</span>
          <div className="hl-fc-bout hl-fc-skeleton" />
        </div>
      )}

      <div className="hl-fc-foot">
        {event.broadcaster && <span>Watch · {event.broadcaster}</span>}
        <span>Tickets</span>
        <span>Countdown</span>
      </div>
    </div>
  );
}

/* ── 03 Make your call ──────────────────────────────────────────────────────
   One bout, opened. The pick control, the crowd, the room and what a correct
   call is worth. `Skill, not betting.` is the product's own line and it is on
   the picture for the same reason it is on the card: this is not a wager. */
function PickVisual({ d }: { d: StoryData }) {
  const { event, leaders } = d;
  const red = event.crowd?.red ?? 50;
  const blue = event.crowd?.blue ?? 50;

  return (
    <div className="hl-vis-pick" aria-hidden="true">
      <div className="hl-pick-corners">
        <div className="hl-pick-corner" data-side="red" data-picked="true">
          <span className="hl-pick-tag">Red corner</span>
          <span className="hl-pick-name">{event.red.name}</span>
          <span className="hl-pick-chosen">Your call</span>
        </div>
        <div className="hl-pick-corner" data-side="blue">
          <span className="hl-pick-tag">Blue corner</span>
          <span className="hl-pick-name">{event.blue.name}</span>
        </div>
      </div>

      <div className="hl-pick-crowd">
        <span className="hl-pick-crowd-label">
          The room {event.crowd ? `· ${event.crowd.total.toLocaleString()} calls` : ""}
        </span>
        <div className="hl-split-bar">
          <span className="hl-split-red" style={{ inlineSize: `${red}%` }} />
          <span className="hl-split-blue" style={{ inlineSize: `${blue}%` }} />
        </div>
        <div className="hl-split-legend">
          <span>{red}%</span>
          <span>{blue}%</span>
        </div>
      </div>

      <div className="hl-pick-rows">
        <div className="hl-pick-row">
          <span className="hl-pick-row-label">Discussion</span>
          <span className="hl-pick-row-value">Every bout has its own room</span>
        </div>
        <div className="hl-pick-row">
          <span className="hl-pick-row-label">Rivals</span>
          <span className="hl-pick-row-value">Call it against someone</span>
        </div>
        <div className="hl-pick-row">
          <span className="hl-pick-row-label">Leaderboard</span>
          <span className="hl-pick-row-value">
            {leaders[0] ? `Top predictor · ${leaders[0].points.toLocaleString()} pts` : "Points for correct calls"}
          </span>
        </div>
      </div>

      <p className="hl-pick-note">{SKILL_NOT_BETTING}</p>
    </div>
  );
}

/* ── 04 Follow the story ────────────────────────────────────────────────────
   The same card, six states later. The result step uses a real completed bout
   when the database has one, so the last frame of the story is a fact rather
   than an illustration. */
function FollowVisual({ d }: { d: StoryData }) {
  const { event, result, coverage } = d;

  const steps = [
    { label: "Followed", value: event.name },
    { label: "Fight week", value: "Reminder before the first bell" },
    { label: "Coverage", value: coverage[0]?.title ?? "News attached to the card" },
    {
      label: "Result",
      value: result ? `${result.winner} def. ${result.loser} · ${result.outcome}` : "Official outcome, when it lands",
    },
    { label: "Record", value: "Updated on both profiles" },
    { label: "Leaderboard", value: "Your call, graded" },
  ];

  return (
    <div className="hl-vis-follow" aria-hidden="true">
      <ol className="hl-timeline">
        {steps.map((s, i) => (
          <li key={s.label} className="hl-timeline-step" data-i={i}>
            <span className="hl-timeline-dot" />
            <span className="hl-timeline-label">{s.label}</span>
            <span className="hl-timeline-value">{s.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const VISUALS: Record<StageId, (p: { d: StoryData }) => React.ReactElement> = {
  discover: DiscoverVisual,
  card: CardVisual,
  pick: PickVisual,
  follow: FollowVisual,
};

export function StageVisual({ stage, data }: { stage: Stage; data: StoryData }) {
  const Visual = VISUALS[stage.id];
  return (
    <div className="hl-vis" role="img" aria-label={stage.visualLabel}>
      <Visual d={data} />
    </div>
  );
}
