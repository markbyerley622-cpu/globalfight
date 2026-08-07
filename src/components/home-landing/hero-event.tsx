import Link from "next/link";
import { CalendarDays, MapPin, Tv, Swords } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { HeroCountdown } from "./hero-countdown";
import type { HeroEvent, MiniEvent } from "./data";

/**
 * The hero's product demonstration: ONE real upcoming card, at a size a person
 * can actually read.
 *
 * It is a demonstration and not a component reused from /events, deliberately.
 * The production `EventCard` carries Quick Pick, Follow, Share, Add-to-calendar
 * and outbound ticket links — five controls that write to the database or leave
 * the site, every one of which is either a 401 or a dead end for the signed-out
 * visitor this page is written for. Putting it here would mean shipping working
 * buttons that do not work. So this shows the same FIELDS, in the same order,
 * in the product's own language, and every path out of it leads to the real
 * event page where those controls do work.
 *
 * What it shows is what the database has. A missing venue, broadcaster, record
 * or ranking renders as absent, never as "TBA" invented on the page's behalf,
 * and never as a number the registry cannot support.
 */

function Corner({
  name,
  slug,
  record,
  rank,
  side,
  linked,
}: {
  name: string;
  slug: string | null;
  record: string;
  rank: number | null;
  side: "red" | "blue";
  linked: boolean;
}) {
  const inner = (
    <>
      {/* The corner is named in words as well as in colour. Red/blue alone is
          meaning carried by colour, which fails both WCAG 1.4.1 and anyone
          reading this on a phone in sunlight. */}
      <span className="hl-corner-tag" data-side={side}>
        {side === "red" ? "Red corner" : "Blue corner"}
      </span>
      <span className="hl-corner-name">{name}</span>
      <span className="hl-corner-meta">
        {record || "Record not published"}
        {rank !== null && <span className="hl-rank">#{rank}</span>}
      </span>
    </>
  );

  return linked && slug ? (
    <Link href={`/fighters/${slug}`} className="hl-corner" data-side={side}>
      {inner}
    </Link>
  ) : (
    <div className="hl-corner" data-side={side}>
      {inner}
    </div>
  );
}

export function HeroEventExperience({ event, upNext }: { event: HeroEvent; upNext: MiniEvent[] }) {
  const { placeholder } = event;

  return (
    <div className="hl-stage">
      {/* ── The card ───────────────────────────────────────────────────── */}
      <article className="hl-card" aria-label={`Featured event: ${event.name}`}>
        <header className="hl-card-head">
          <div className="hl-card-org">
            <span className="hl-promo">{event.promotion}</span>
            <span className="hl-sport">{event.sport}</span>
          </div>
          {event.titleFight && <span className="hl-title-badge">Title fight</span>}
        </header>

        <h2 className="hl-card-name">
          {placeholder ? (
            event.name
          ) : (
            <Link href={`/events/${event.slug}`}>{event.name}</Link>
          )}
        </h2>

        {/* A placeholder card must never carry a countdown or a date: a
            fabricated moment in time is the one thing a fight calendar cannot
            be caught doing. It says what it is instead. */}
        {placeholder ? (
          <p className="hl-card-meta">
            An example card. Live events appear here as they are published.
          </p>
        ) : (
          <ul className="hl-card-meta">
            <li>
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {formatDate(event.date, { weekday: "short" })}
            </li>
            {event.location && (
              <li>
                <MapPin className="size-3.5" aria-hidden="true" />
                {event.venue ? `${event.venue}, ${event.location}` : event.location}
              </li>
            )}
            {event.broadcaster && (
              <li>
                <Tv className="size-3.5" aria-hidden="true" />
                {event.broadcaster}
              </li>
            )}
            {event.boutCount > 0 && (
              <li>
                <Swords className="size-3.5" aria-hidden="true" />
                {event.boutCount} bout{event.boutCount === 1 ? "" : "s"}
              </li>
            )}
          </ul>
        )}

        <div className="hl-matchup">
          <Corner {...event.red} side="red" linked={!placeholder} />
          <span className="hl-vs" aria-hidden="true">
            vs
          </span>
          <Corner {...event.blue} side="blue" linked={!placeholder} />
        </div>

        {/* ── Crowd split ────────────────────────────────────────────────
            Fan calls, not odds: a percentage of the people who made a pick,
            with the count beside it so the number can be judged. No price, no
            stake, no implied payout. */}
        <div className="hl-split">
          <div className="hl-split-head">
            <span>Who the fans have</span>
            <span className="hl-split-count">
              {event.crowd ? `${event.crowd.total.toLocaleString()} calls` : "No calls yet"}
            </span>
          </div>
          {event.crowd ? (
            <>
              <div
                className="hl-split-bar"
                role="img"
                aria-label={`Crowd split: ${event.crowd.red} percent for ${event.red.name}, ${event.crowd.blue} percent for ${event.blue.name}`}
              >
                <span className="hl-split-red" style={{ inlineSize: `${event.crowd.red}%` }} />
                <span className="hl-split-blue" style={{ inlineSize: `${event.crowd.blue}%` }} />
              </div>
              <div className="hl-split-legend" aria-hidden="true">
                <span>{event.crowd.red}%</span>
                <span>{event.crowd.blue}%</span>
              </div>
            </>
          ) : (
            <p className="hl-split-empty">Be the first to call it.</p>
          )}
        </div>

        <footer className="hl-card-foot">
          {placeholder ? (
            <span className="hl-card-cta" aria-disabled="true">
              Full card
            </span>
          ) : (
            <Link href={`/events/${event.slug}`} className="hl-card-cta">
              Full card
            </Link>
          )}
          {!placeholder && <HeroCountdown date={event.date} />}
        </footer>
      </article>

      {/* ── The ecosystem, hinted ──────────────────────────────────────────
          Three small satellites, each a real surface this card connects to.
          Restrained on purpose: they are evidence that the card is not the whole
          product, not a second navigation. Hidden below `lg`, where they would
          push the CTA under the fold on a phone. */}
      <aside className="hl-satellites" aria-label="What this card connects to">
        <div className="hl-sat">
          <span className="hl-sat-label">Fighter profile</span>
          <span className="hl-sat-value">{event.red.name}</span>
          <span className="hl-sat-note">{event.red.record || "Record on file"}</span>
        </div>
        <div className="hl-sat">
          <span className="hl-sat-label">Following</span>
          <span className="hl-sat-value">Fight-week alerts</span>
          <span className="hl-sat-note">For events and fighters you follow</span>
        </div>
        {upNext[0] && (
          <div className="hl-sat">
            <span className="hl-sat-label">Also upcoming</span>
            <span className="hl-sat-value">{upNext[0].name}</span>
            <span className="hl-sat-note">
              {upNext[0].location ?? upNext[0].promotion}
            </span>
          </div>
        )}
      </aside>

      {/* ── Up next ────────────────────────────────────────────────────────
          Three more real cards, one line each. Proof that the calendar is a
          calendar — without becoming one. */}
      {upNext.length > 0 && (
        <ul className="hl-upnext" aria-label="Also coming up">
          {upNext.map((e) => (
            <li key={e.slug ?? e.name}>
              <Link href={`/events/${e.slug}`}>
                <span className="hl-upnext-sport">{e.sport}</span>
                <span className="hl-upnext-name">{e.name}</span>
                <span className="hl-upnext-when">{formatDate(e.date, { year: undefined })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
