"use client";

import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays, MapPin as MapPinIcon, Navigation, ExternalLink, ChevronRight,
  Users, Dumbbell, Swords, BadgeCheck, Flame,
} from "lucide-react";
import { PromotionLogo } from "@/components/promotion-logo";
import { formatDistance } from "@/lib/geo/gazetteer";
import { directionsUrl, type MapLayer, type MapPin } from "@/lib/geo/types";
import { LAYER_COLOR } from "./map-canvas";
import { CheckInButton } from "./check-in-button";
import { FollowButton } from "@/components/follow-button";
import { cn } from "@/lib/utils";

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", year: "numeric",
});

/** `relative` is false when the label IS the date — the detail card uses that
 *  to avoid printing "Sat, 8 Aug 2026 · Sat, 8 Aug 2026". */
function whenLabel(iso: string): { text: string; soon: boolean; relative: boolean } {
  const d = new Date(iso);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < -1) return { text: DATE_FMT.format(d), soon: false, relative: false };
  if (days < 0) return { text: "Yesterday", soon: false, relative: true };
  if (days === 0) return { text: "Today", soon: true, relative: true };
  if (days === 1) return { text: "Tomorrow", soon: true, relative: true };
  if (days <= 14) return { text: `In ${days} days`, soon: days <= 7, relative: true };
  return { text: DATE_FMT.format(d), soon: false, relative: false };
}

const LAYER_ICON: Record<MapLayer, typeof Users> = {
  events: CalendarDays,
  gyms: Dumbbell,
  people: Users,
  clubs: Swords,
};

/** The small square identity mark — poster, gym hero, avatar or crest. */
function Mark({ pin, size }: { pin: MapPin; size: number }) {
  const accent = LAYER_COLOR[pin.layer];
  const Icon = LAYER_ICON[pin.layer];
  const round = pin.layer === "people";
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden border",
        round ? "rounded-full" : "rounded-xl",
      )}
      style={{ width: size, height: size, borderColor: `${accent}44`, background: `${accent}14` }}
    >
      {pin.imageUrl ? (
        <Image src={pin.imageUrl} alt="" fill sizes={`${size}px`} className="object-cover" unoptimized />
      ) : pin.layer === "events" ? (
        <PromotionLogo promotion={pin.promotion} size={size > 50 ? "md" : "sm"} />
      ) : (
        <Icon style={{ color: accent, width: size * 0.4, height: size * 0.4 }} />
      )}
    </span>
  );
}

/** One tappable result — used in the sheet lists and the discovery rail. */
export function PinRow({
  pin, distanceKm, active, onClick,
}: {
  pin: MapPin;
  distanceKm?: number | null;
  active?: boolean;
  onClick?: () => void;
}) {
  const when = pin.date ? whenLabel(pin.date) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-blood-500/50 bg-blood-500/10"
          : "border-ink-700 bg-ink-900/70 hover:border-ink-600 hover:bg-ink-850",
      )}
    >
      <Mark pin={pin} size={36} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-display text-[0.86rem] font-bold text-chalk">{pin.name}</span>
          {pin.gym?.verified && <BadgeCheck className="size-3.5 shrink-0 text-volt-400" />}
          {pin.status === "LIVE" && <span className="live-dot shrink-0" />}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[0.72rem] text-fog">
          {(pin.presentNow ?? 0) > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-blood-300">
              <Flame className="size-3" />{pin.presentNow}
            </span>
          )}
          <span className="truncate">{pin.address ?? pin.subtitle}</span>
        </span>
      </span>

      <span className="shrink-0 text-right">
        {when && (
          <span className={cn("block font-display text-[0.72rem] font-bold uppercase tracking-wide", when.soon ? "text-blood-300" : "text-mist")}>
            {when.text}
          </span>
        )}
        {typeof distanceKm === "number" && (
          <span className="block text-[0.68rem] tabular-nums text-fog">{formatDistance(distanceKm)}</span>
        )}
      </span>
    </button>
  );
}

/**
 * The full detail card.
 *
 * One component, four entity shapes. They share an identity header, a facts
 * list and an action row because they are all "a thing on a map" — branching
 * only where the entities genuinely differ (a person can be followed, a place
 * can be checked into, an event has a date).
 */
export function PinDetail({
  pin, distanceKm, signedIn, following,
}: {
  pin: MapPin;
  distanceKm?: number | null;
  signedIn: boolean;
  /** Whether the viewer already follows this person. People pins only. */
  following?: boolean;
}) {
  const when = pin.date ? whenLabel(pin.date) : null;
  const accent = LAYER_COLOR[pin.layer];
  const isPlace = pin.layer === "gyms" || pin.layer === "events";

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3">
        <Mark pin={pin} size={68} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {pin.badge && (
              <span
                className="rounded-md px-1.5 py-0.5 font-display text-[0.6rem] font-bold uppercase tracking-wider"
                style={{ background: `${accent}22`, color: accent }}
              >
                {pin.badge}
              </span>
            )}
            {pin.gym?.verified && (
              <span className="inline-flex items-center gap-1 rounded-md bg-volt-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-volt-400">
                <BadgeCheck className="size-3" /> Verified
              </span>
            )}
            {pin.precision === "country" && (
              <span className="rounded-md bg-ink-800 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-fog">
                Approx.
              </span>
            )}
          </div>
          <h3 className="mt-1 font-display text-[1.05rem] font-black leading-tight text-chalk">{pin.name}</h3>
          {pin.subtitle && <p className="mt-0.5 truncate text-[0.76rem] text-mist">{pin.subtitle}</p>}
        </div>
      </div>

      {/* Facts */}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 text-[0.76rem]">
        {when && (
          <>
            <dt className="pt-px text-fog"><CalendarDays className="size-3.5" /></dt>
            <dd className="text-mist">
              {when.text}
              {when.relative && pin.date && (
                <span className="text-fog"> · {DATE_FMT.format(new Date(pin.date))}</span>
              )}
            </dd>
          </>
        )}
        {pin.address && (
          <>
            <dt className="pt-px text-fog"><MapPinIcon className="size-3.5" /></dt>
            <dd className="text-mist">
              {pin.address}
              {typeof distanceKm === "number" && (
                <span className="text-fog"> · {formatDistance(distanceKm)} away</span>
              )}
            </dd>
          </>
        )}
        {pin.gym && (
          <>
            <dt className="pt-px text-fog"><Users className="size-3.5" /></dt>
            <dd className="text-mist">
              {pin.gym.memberCount} member{pin.gym.memberCount === 1 ? "" : "s"}
              {pin.gym.disciplines.length > 0 && (
                <span className="text-fog"> · {pin.gym.disciplines.join(", ")}</span>
              )}
            </dd>
          </>
        )}
        {pin.club && (
          <>
            <dt className="pt-px text-fog"><Users className="size-3.5" /></dt>
            <dd className="text-mist">
              {pin.club.memberCount} member{pin.club.memberCount === 1 ? "" : "s"}
              {pin.club.meetsOn && <span className="text-fog"> · {pin.club.meetsOn}</span>}
            </dd>
          </>
        )}
        {pin.person?.trainingAt && (
          <>
            <dt className="pt-px text-up"><Flame className="size-3.5" /></dt>
            <dd className="font-semibold text-up">
              Training now at{" "}
              <Link href={`/gyms/${pin.person.trainingAt.gymSlug}`} className="underline-offset-2 hover:underline">
                {pin.person.trainingAt.gymName}
              </Link>
              {pin.person.trainingAt.note && <span className="font-normal text-fog"> · {pin.person.trainingAt.note}</span>}
            </dd>
          </>
        )}
        {pin.person?.homeGym && !pin.person.trainingAt && (
          <>
            <dt className="pt-px text-fog"><Dumbbell className="size-3.5" /></dt>
            <dd className="text-mist">
              Trains at{" "}
              <Link href={`/gyms/${pin.person.homeGym.slug}`} className="text-chalk underline-offset-2 hover:underline">
                {pin.person.homeGym.name}
              </Link>
            </dd>
          </>
        )}
        {(pin.presentNow ?? 0) > 0 && (
          <>
            <dt className="pt-px text-blood-400"><Flame className="size-3.5" /></dt>
            <dd className="font-semibold text-blood-300">
              {pin.presentNow} here right now
            </dd>
          </>
        )}
      </dl>

      {/* Actions */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {pin.layer === "people" && pin.person?.username && (
          <FollowButton
            kind="person"
            slug={pin.person.username}
            name={pin.name ?? pin.person.username}
            initialFollowing={!!following}
            size="sm"
          />
        )}
        {isPlace && (
          <CheckInButton
            gymId={pin.layer === "gyms" ? pin.id.replace(/^g-/, "") : undefined}
            eventId={pin.layer === "events" ? pin.id : undefined}
            initialHere={pin.presentNow ?? 0}
            initialChecked={false}
            signedIn={signedIn}
          />
        )}
        {pin.href && (
          <Link
            href={pin.href}
            className={cn(
              "tap inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide transition-colors",
              pin.layer === "people" || isPlace
                ? "border border-ink-600 bg-ink-800 text-chalk hover:border-ink-500"
                : "bg-blood-500 text-white hover:bg-blood-400",
            )}
          >
            {pin.layer === "people" ? "Profile" : "Details"} <ChevronRight className="size-3.5" />
          </Link>
        )}
        {/* A person is not a destination — no Directions to somebody's city. */}
        {pin.layer !== "people" && (
          <a
            href={directionsUrl(pin)}
            target="_blank"
            rel="noopener noreferrer"
            className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-3.5 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide text-chalk transition-colors hover:border-ink-500"
          >
            <Navigation className="size-3.5" /> Directions
          </a>
        )}
        {pin.website && (
          <a
            href={pin.website}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3.5 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide text-mist transition-colors hover:text-chalk"
          >
            <ExternalLink className="size-3.5" /> Website
          </a>
        )}
      </div>

      {pin.layer === "people" && (
        <p className="mt-2.5 text-[0.68rem] leading-relaxed text-fog">
          Shown in {pin.address?.split(" · ").pop() ?? "their city"} — people are placed at their city, never a
          precise location.
        </p>
      )}
      {pin.layer !== "people" && pin.precision === "country" && (
        <p className="mt-2.5 text-[0.68rem] leading-relaxed text-fog">
          Pinned to the country — we don&apos;t have this venue&apos;s exact position yet. Directions search for the
          venue by name.
        </p>
      )}
    </div>
  );
}
