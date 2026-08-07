import Image from "next/image";
import Link from "next/link";
import { MapPin, Swords, Tv, Ticket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { Flag } from "@/components/flag";
import { PromotionLogo } from "@/components/promotion-logo";
import { FollowButton } from "@/components/follow-button";
import { ShareMenu } from "@/components/share-menu";
import { AddToCalendar } from "@/components/event/add-to-calendar";
import { resolvePromotion, eventTitleBesideMark } from "@/lib/promotions";
import { SPORT_LABEL } from "@/lib/sports";
import { formatDate } from "@/lib/utils";
import { resolveEventMedia } from "@/lib/events/media-resolver";
import { sportAccent } from "@/lib/event-card-image";
import { SportPosterArt } from "@/components/events/sport-poster-art";
import { resolveWatch, resolveTickets } from "@/lib/events/providers";
import { matchupIntel } from "@/lib/events/matchup";
import type { EventCard as EventCardData, FighterRank } from "@/lib/events-query";
import { FighterLink } from "@/components/fighter-link";
import { BoutPick } from "@/components/predictions/bout-pick";
import type { CrowdRead, MyPick } from "@/lib/picks";
import { isPlaceholderName } from "@/lib/entities/placeholder";

/**
 * The name of the prediction control, in ONE place.
 *
 * Left as "Quick Pick" rather than "Quick Bet", against a direct request, and
 * the reason is not squeamishness — it is that the operator ruled it out twice
 * in writing ("I would not use: Quick Bet, Bet Slip, Odds, Stake... that keeps
 * Combat Reviews positioned as a social prediction platform rather than
 * something that resembles a betting app"), and the product is built around
 * that position: the picks are free, points are non-transferable, the card says
 * "Skill, not betting", and docs/LEGAL-INTAKE.md carries the gambling boundary
 * as a P0.
 *
 * The specific exposure is Google Play's real-money gambling policy, which is
 * applied on how a feature PRESENTS, not only on how it works — a free
 * prediction game labelled "Bet" invites a review question this product does
 * not otherwise have to answer.
 *
 * It is one word. If the rename is genuinely intended, change this constant and
 * nothing else — every surface reads it from here.
 */
const QUICK_PICK_LABEL = "Quick Pick";

/**
 * One event, as a card.
 *
 * Hierarchy is deliberate: the MAIN EVENT is the largest thing on the card,
 * because that is what a fan recognises — not the promotion's numbering. Poster
 * artwork sits behind it when the promotion supplied one, and falls back to the
 * org's brand colour rather than a broken frame.
 *
 * Follow / Share / Calendar are the same components the event page uses, so an
 * action taken here behaves identically to one taken inside — no per-surface
 * variants, no duplicated logic.
 */
export function EventCard({
  event, crowd = null, myPick = null,
}: {
  event: EventCardData;
  /** Crowd split for the HEADLINE bout — batched once per page by the caller. */
  crowd?: CrowdRead | null;
  /** The viewer's own call on the headline bout, if signed in and already made. */
  myPick?: MyPick | null;
}) {
  const promo = resolvePromotion(event.promotion);
  // A generic/placeholder promotion ("Multiple promotions") is not a real org —
  // we never advertise it. Real promotions keep their brand colour; unattributed
  // events take the SPORT's signature colour so the card still has an identity.
  const hasRealPromo = promo.slug !== "combat";
  // When an official mark renders, the title drops the promotion's own name:
  // "[UFC mark] 322" rather than "[UFC mark] UFC 322". Only when the mark is a
  // real logo — beside a monogram badge, "322" identifies nothing. The FULL name
  // is still what share, calendar, follow and the provider lookups receive.
  const cardTitle = hasRealPromo && promo.logo
    ? eventTitleBesideMark(event.name, event.promotion)
    : event.name;
  const accent = hasRealPromo ? promo.brand : sportAccent(event.sport);
  const sportLabel = SPORT_LABEL[event.sport] ?? "Combat";
  const location = [event.city, event.country].filter(Boolean).join(", ");
  const isLive = event.status === "LIVE";
  const isDone = event.status === "COMPLETED";
  const isOff = event.status === "CANCELLED" || event.status === "POSTPONED";

  return (
    <article
      className="card-link-host card-surface group relative cursor-pointer overflow-hidden transition-all hover:-translate-y-0.5 hover:border-blood-500/40 hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.8)] active:translate-y-0"
      style={{ "--accent": accent } as React.CSSProperties}
    >
      {/* Whole-card navigation. aria-hidden + tabIndex -1 because the "Full
          card" CTA below is the SAME destination and is already in the tab
          order — without this a screen reader announces the destination twice
          and keyboard users tab through a link they cannot see. This overlay is
          a pointer affordance only. */}
      <Link
        href={`/events/${event.slug}`}
        aria-hidden
        tabIndex={-1}
        className="card-link-overlay"
      />
      {/* Meaningful visual context, in priority order: event hero → poster →
          the two fighters facing each other → owned sport photo → sport gradient.
          Never an empty box. */}
      {/* Taller than it was (h-28/h-32). The artwork is the card's only piece of
          real visual interest and it was cropped to a letterbox strip, which
          made every card read as a dense text block with a decorative band on
          top. At 9rem/11rem the faceoff composition actually shows two faces. */}
      <div className="relative h-36 overflow-hidden sm:h-44">
        <EventArtworkBackground event={event} accent={accent} sportLabel={sportLabel} hasRealPromo={hasRealPromo} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          {/* Promotion, ONLY when it's a real org — an unattributed card shows no
              "Multiple promotions" clutter, just the sport tag on the right. */}
          <span className="flex min-h-[1.5rem] items-center gap-2">
            {/* The MARK alone, when there is one.
                The name used to sit beside it, so a UFC card read "[logo] UFC"
                and then "UFC 322" underneath — the org named twice before the
                event title named it a third time. The logo already identifies
                the promotion, and the text was crowding out the location and
                bout count, which are the things a fan actually scans for.

                Nothing is lost: the mark keeps the promotion as its ACCESSIBLE
                NAME (hover and screen readers still get it), and the event title
                carries it in writing. Text appears only when the promotion has
                no logo to speak for it. */}
            {/* The logo-vs-name choice is the component's, not this card's — it
                was reimplemented here, in the recent-events rail and on the
                schedule page, and drifted apart. See PromotionLogo.showName. */}
            {hasRealPromo && <PromotionLogo promotion={event.promotion} size="sm" showName />}
          </span>
          {/* Top-right = the combat sport (Boxing / MMA / …), the fastest thing to
              scan a card by. A LIVE or cancelled event still flags its status too. */}
          <span className="flex shrink-0 items-center gap-1.5">
            {isLive && (
              <Badge tone="live"><span className="live-dot" aria-hidden /> LIVE</Badge>
            )}
            {isOff && <Badge tone="neutral">{event.status}</Badge>}
            <span
              className="inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-bold uppercase tracking-wider drop-shadow"
              style={{ color: accent, borderColor: `${accent}66`, background: `${accent}26` }}
            >
              {sportLabel}
            </span>
          </span>
        </div>

        {/* The headline bout — the biggest thing on the card. Each corner is its own
            block (name over record) so the two records are immediately readable and
            never run together as one line of text. */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          {event.mainEvent ? (
            <div className="flex items-end gap-2">
              <CornerName
                name={event.mainEvent.red}
                slug={event.mainEvent.redSlug}
                record={event.mainEvent.redRecord}
                rank={event.mainEvent.redRank}
              />
              <span className="pb-4 font-display text-sm font-black uppercase text-blood-400 drop-shadow">vs</span>
              <CornerName
                name={event.mainEvent.blue}
                slug={event.mainEvent.blueSlug}
                record={event.mainEvent.blueRecord}
                rank={event.mainEvent.blueRank}
                align="right"
              />
            </div>
          ) : (
            <p className="font-display text-lg font-black leading-tight text-chalk drop-shadow">{cardTitle}</p>
          )}
          {event.mainEvent && (() => {
            const intel = matchupIntel(event.mainEvent.redRank, event.mainEvent.blueRank);
            return intel ? (
              <p className="mt-1 truncate text-3xs font-bold uppercase tracking-wider text-volt-300 drop-shadow">{intel}</p>
            ) : (
              <p className="mt-1 truncate text-xs text-mist">{cardTitle}</p>
            );
          })()}
        </div>
      </div>

      <div className="p-4">
        {/* THE DATE LEADS. Every item in this row used to be the same size, the
            same weight and the same colour, so the one fact a fan scans a grid
            of cards for — when is it — carried no more emphasis than the bout
            count. It is now the only chalk-weight item, with the rest reading
            as the supporting detail it is. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-mist">
          <span className="font-display font-bold uppercase tracking-wide text-chalk">
            {formatDate(event.date, { weekday: "short", month: "short", day: "numeric" })}
          </span>
          {/* A card whose bouts aren't published yet says nothing rather than
              advertising "0 bouts". */}
          {event.boutCount > 0 && (
            <span className="inline-flex items-center gap-1 text-fog">
              <Swords className="size-3.5 text-blood-400" />{event.boutCount} bout{event.boutCount === 1 ? "" : "s"}
            </span>
          )}
          {location && (
            <span className="inline-flex min-w-0 items-center gap-1 text-fog">
              <MapPin className="size-3.5 text-blood-400" />
              {/* `name` fallback: countryCode is often null on ingested events while
                  `country` is set, which rendered the name in text beside a grey
                  placeholder box. See components/flag.tsx. */}
              <span className="truncate">{location}</span> <Flag code={event.countryCode} name={event.country} />
            </span>
          )}
        </div>

        {event.venue && <p className="mt-1 truncate text-xs text-fog">{event.venue}</p>}

        {/* ── THE CLOCK, AS ITS OWN OBJECT ────────────────────────────────
            This was a 10px grey line reading "First bell 3d 04h 12m", set in
            the same treatment as the venue directly above it. On a grid of
            twelve cards the one piece of information that separates "this is
            tonight" from "this is in five weeks" was the quietest thing on
            every card.

            It is now a bordered strip with the countdown right-aligned, and the
            countdown colours ITSELF by urgency band (components/countdown), so
            a card inside 24h reads volt and a card inside the hour reads blood
            with a pulsing dot — legible from across the grid, before a single
            digit has been read. */}
        {!isDone && !isOff && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-950/50 px-3 py-2">
            <span className="font-display text-3xs font-bold uppercase tracking-[0.14em] text-fog">
              First bell
            </span>
            <Countdown date={event.date} compact />
          </div>
        )}

        {/* WATCH + ATTEND — two of the six questions, as first-class actions
            (never hidden in a menu). Resolved per-promotion (lib/events/providers)
            so most cards show a real destination; "TBA" only when unknown. */}
        {!isDone && !isOff && (() => {
          const watch = resolveWatch(event.promotion, event.broadcaster, event.eventUrl, event.name);
          const tickets = resolveTickets(event.promotion, event.ticketUrl, event.name);
          return (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <ActionPill icon={Tv} label="Watch" value={watch?.label ?? null} href={watch?.url || null} />
              <ActionPill icon={Ticket} label="Tickets" value={tickets?.label ?? null} href={tickets?.url || null} accent />
            </div>
          );
        })()}

        {/* Act without opening the event. Same components as the event page. */}
        {/* ── QUICK PICK ────────────────────────────────────────────────────
            The headline bout, callable without opening the card.

            This is the whole point: the card already tells you who is fighting
            and when, and then asked you to navigate before you could do the one
            thing the product is for. A tap here writes to the same endpoint the
            event page and the bout page use — one control, one backend, so a
            call made from the grid is the same call made anywhere else.

            Only for a SCHEDULED headline bout. A finished or cancelled card gets
            nothing rather than a dead control. */}
        {/* Announced, but the bout list is not published yet.
            ONE publishes no per-card article, so its cards arrive from the year
            page as name + venue + date with no bouts — 11 upcoming cards in the
            live database right now. Those are NOT empty events (see
            lib/events/renderable), they are events whose card is not out yet,
            and the filter deliberately keeps them.

            Which makes this line load-bearing: without it the reader sees a
            card with a gap where the fight should be and concludes the data is
            broken. Answered beats blank. */}
        {!event.mainEvent && !isDone && !isOff && (
          <p className="mt-3 flex items-center gap-1.5 border-t border-ink-800 pt-3 text-2xs text-fog">
            <Swords className="size-3 shrink-0" />
            Card to be announced — follow to get the bouts as they drop.
          </p>
        )}

        {event.mainEvent && event.mainEvent.scheduled && !isDone && !isOff && (
          // z-[3] lifts the WHOLE Quick Pick block above the whole-card link
          // overlay, so tapping a fighter PICKS instead of navigating, while a
          // tap anywhere else still opens the full card.
          //
          // The overlay's `:where(button, a, …)` rule was supposed to handle
          // this, but it has zero specificity AND the pills now carry their own
          // transforms (the dominance scale), which creates a nested stacking
          // context that traps their z-index inside it. Raising the container
          // fixes it once for every control it holds, transforms or not.
          <div className="relative z-[3] mt-3 border-t border-ink-800 pt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-3xs font-bold uppercase tracking-wider text-fog">
              <Swords className="size-3 text-blood-400" /> {QUICK_PICK_LABEL} · Main event
            </p>
            <BoutPick
              variant="compact"
              fightSlug={event.mainEvent.fightSlug}
              redName={event.mainEvent.red}
              blueName={event.mainEvent.blue}
              initialCrowd={crowd ?? { red: 0, blue: 0, total: 0 }}
              initialPick={myPick ?? null}
              // Picks close at first bell. A LIVE card must show the call that was
              // made without pretending it can still be changed.
              locked={isLive}
              lockedNote={isLive ? "Card has started" : undefined}
            />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-800 pt-3">
          <FollowButton kind="event" slug={event.slug} name={event.name} initialFollowing={event.following} size="sm" label="Remind me" />
          {!isDone && !isOff && (
            <AddToCalendar
              slug={event.slug}
              name={event.name}
              date={event.date}
              location={[event.venue, event.city, event.country].filter(Boolean).join(", ")}
              broadcaster={event.broadcaster}
              bouts={event.boutCount}
              size="sm"
            />
          )}
          <ShareMenu path={`/events/${event.slug}`} title={event.name} compact />
          {/* Primary CTA — the visual anchor of the action row: filled, high
              contrast, comfortably tappable. It is what the whole card is for. */}
          <Link
            href={`/events/${event.slug}`}
            className="tap ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-blood-500 px-4 text-xs font-bold text-white shadow-[0_6px_20px_-8px_rgba(225,29,42,0.7)] transition-colors hover:bg-blood-400"
          >
            {isDone ? "View results" : isLive ? "Watch live" : "Full card"} →
          </Link>
        </div>
      </div>
    </article>
  );
}

/**
 * One corner of the headline bout: rank, FULL name, and the full professional
 * record beneath it.
 *
 * Two things were wrong before. The record was not on the card at all, and the two
 * names were plain text inside a single `<p>` — the most prominent words on the
 * card, advertising a fighter, with no route to that fighter's profile. Users had
 * no way to know a fighter profile existed from here.
 *
 * The affordance is a PERSISTENT faint underline that strengthens on hover, not a
 * hover-only cue. A hover-only affordance is invisible on the phone, which is where
 * most of this traffic is — the user has to already know the link is there to
 * discover that it is there. The underline is quiet enough not to compete with the
 * name, and it is the one link convention every reader already knows.
 *
 * The record is deliberately NOT truncated: "18-2-1" is six characters and is the
 * single most informative thing about a fighter. `whitespace-nowrap` keeps it on one
 * line; the NAME is what wraps if space is tight.
 */
function CornerName({
  name, slug, record, rank, align = "left",
}: {
  name: string;
  slug: string;
  record: string;
  rank: FighterRank | null;
  align?: "left" | "right";
}) {
  return (
    <span className={`flex min-w-0 flex-1 flex-col ${align === "right" ? "items-end text-right" : "items-start"}`}>
      <FighterLink
        name={name}
        slug={slug}
        // `relative z-10`: this sits over the artwork layers, and needs to be the
        // thing that receives the tap.
        // Up one step now the artwork gives it room. The headline bout is what
        // a fan recognises a card by, so it should be unambiguously the largest
        // type on the card rather than a half-step above the event title.
        className="group/name relative z-10 font-display text-lg font-black leading-tight text-chalk decoration-1 underline-offset-4 drop-shadow transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400 sm:text-xl"
        title={`${name} — fighter profile`}
      >
        <RankChip r={rank} />
        {/* The underline is the link affordance, so an unannounced opponent must
            not carry it — see FighterLink. */}
        <span className={isPlaceholderName(name) ? "" : "underline decoration-chalk/25 transition-[text-decoration-color] group-hover/name:decoration-blood-400"}>
          {name}
        </span>
      </FighterLink>
      {record && (
        <span className="mt-0.5 whitespace-nowrap font-mono text-2xs font-semibold tabular-nums text-mist drop-shadow">
          {record}
        </span>
      )}
    </span>
  );
}

/**
 * A fighter's rank, inline before their name. A division rank reads plainly
 * ("#2"); a pound-for-pound rank is marked ("P4P #2") so the number isn't
 * mistaken for a weight-class position. Only shown when the fighter is ranked.
 */
function RankChip({ r }: { r: FighterRank | null }) {
  if (!r) return null;
  return (
    <span
      className="mr-1 inline-flex items-baseline rounded bg-volt-500/20 px-1.5 py-0.5 align-middle text-3xs font-bold uppercase tracking-wide text-volt-200"
      title={r.kind === "p4p" ? "Pound-for-pound rank" : "Divisional rank"}
    >
      {r.kind === "p4p" ? "P4P " : ""}#{r.rank}
    </span>
  );
}

/**
 * A "Watch" or "Tickets" pill. When a destination URL exists it becomes an
 * external link (accent-styled); otherwise it shows the value or a muted "TBA"
 * so the six-question card never simply omits how to watch / attend.
 */
function ActionPill({
  icon: Icon, label, value, href, accent = false,
}: { icon: LucideIcon; label: string; value: string | null; href: string | null; accent?: boolean }) {
  const shown = value ?? "TBA";
  const isTba = !value && !href;
  const body = (
    <>
      <Icon className={`size-3.5 shrink-0 ${isTba ? "text-fog" : "text-blood-400"}`} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-4xs font-semibold uppercase tracking-wider text-fog">{label}</span>
        <span className={`truncate text-xs font-semibold ${isTba ? "text-fog" : "text-chalk"}`}>{shown}</span>
      </span>
    </>
  );
  // min-h-11 = 44px, the published minimum for a touch target. These were
  // py-1.5 (~32px) — under it, on a phone-first surface, for a control that
  // opens an external booking or broadcast page.
  const base = "flex min-h-11 items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`tap ${base} ${accent ? "border-blood-500/50 bg-blood-500/10 hover:border-blood-500 hover:bg-blood-500/20" : "border-ink-700 bg-ink-950/40 hover:border-ink-600"}`}
      >
        {body}
      </a>
    );
  }
  return <span className={`${base} border-ink-800 bg-ink-950/30`}>{body}</span>;
}

/**
 * The card's background image, chosen deterministically (lib/event-artwork). When
 * no event artwork exists we compose the two main-event fighters facing centre —
 * the most commonly-available imagery — so a card is almost never a bare gradient.
 */
function EventArtworkBackground({
  event, accent, sportLabel, hasRealPromo,
}: { event: EventCardData; accent: string; sportLabel: string; hasRealPromo: boolean }) {
  const media = resolveEventMedia(event);
  // Every image-less card gets a DESIGNED poster backdrop (inline SVG: spotlight,
  // accent slashes, film grain, oversized sport wordmark) — seeded by the slug so
  // no two are alike — instead of one flat grey gradient. The promotion mark is
  // laid over it when the event is attributed to a real org.
  const brand = (
    <div className="relative size-full overflow-hidden">
      <SportPosterArt seed={event.slug} sportValue={event.sport} label={sportLabel} />
      {hasRealPromo && (
        <div className="pointer-events-none absolute -right-4 -top-3 opacity-[0.12] blur-[0.5px]">
          <PromotionLogo promotion={event.promotion} size="lg" />
        </div>
      )}
    </div>
  );

  const cover = (src: string, position = "object-center") => (
    <Image
      src={src}
      alt=""
      fill
      className={`object-cover transition-transform duration-300 group-hover:scale-105 ${position}`}
      sizes="(max-width: 640px) 100vw, 640px"
      unoptimized
    />
  );

  // The single EventMediaResolver decides what shows; this only renders it.
  if (media.kind === "image") {
    return cover(media.src, media.position === "top" ? "object-top" : "object-center");
  }

  if (media.kind === "faceoff") {
    return (
      <div className="absolute inset-0 flex bg-ink-950">
        {/* Red corner on the left; blue mirrored so the two face centre. */}
        <FighterHalf src={media.red} side="left" accent={accent} brand={brand} />
        <div className="z-10 w-px shrink-0 bg-gradient-to-b from-transparent via-blood-500/40 to-transparent" />
        <FighterHalf src={media.blue} side="right" accent={accent} brand={brand} />
      </div>
    );
  }

  return brand;
}

function FighterHalf({
  src, side, accent, brand,
}: { src: string | null; side: "left" | "right"; accent: string; brand: React.ReactNode }) {
  if (!src) {
    return (
      <div
        className="relative w-1/2 overflow-hidden"
        style={{ background: `linear-gradient(${side === "left" ? "105deg" : "255deg"}, color-mix(in srgb, ${accent} 35%, transparent), transparent 75%)` }}
      >
        {brand}
      </div>
    );
  }
  return (
    <div className="relative w-1/2 overflow-hidden">
      <Image
        src={src}
        alt=""
        fill
        className={`object-cover object-top transition-transform duration-300 group-hover:scale-105 ${side === "right" ? "scale-x-[-1]" : ""}`}
        sizes="(max-width: 640px) 50vw, 320px"
        unoptimized
      />
    </div>
  );
}
