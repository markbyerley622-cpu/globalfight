"use client";

import Link from "next/link";
import { CalendarDays, Flag, Newspaper, Trophy, Swords } from "lucide-react";
import { VideoCard } from "./video-card";
import type { FeedItem } from "@/lib/following";
import { timeAgo, cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  ONE feed card.
//
//  The feed used to be text rows with an emoji in a circle — an RSS listing.
//  Every item is now image-first and scannable at a glance, and there is
//  exactly one card component so the surfaces cannot drift apart.
//
//  Two rules hold everywhere:
//
//   • THERE IS ALWAYS AN IMAGE. It is resolved on the server (lib/following)
//     to either a licensed publisher image or our own branded artwork, so a
//     card never renders blank and never swaps image mid-paint.
//   • THE ASPECT RATIO IS FIXED before anything loads. Every media box is
//     aspect-video with a tinted background, so images arriving late cannot
//     shift the layout under someone's thumb.
//
//  Video is delegated to VideoCard, which owns the one-player and no-autoplay
//  rules — this file does not get a second opinion about playback.
// ════════════════════════════════════════════════════════════════════════════

const KIND_ICON = {
  event_upcoming: CalendarDays,
  fight_upcoming: Swords,
  result: Trophy,
  coverage: Newspaper,
  personal: Flag,
  video: Newspaper,
} as const;

export function FeedCard({ item }: { item: FeedItem }) {
  if (item.kind === "video" && item.video) {
    return (
      <VideoCard
        video={{
          id: item.id.replace(/^vd-/, ""),
          title: item.title,
          channel: item.video.channel,
          publishedAt: item.at,
          promotion: item.video.promotion,
          promotionName: item.video.promotionName,
          reason: item.reason,
        }}
      />
    );
  }

  // Personal items (a reply, a battle result) stay compact on purpose: they are
  // already addressed to you, and a hero image for "someone replied" would be
  // louder than the thing it is telling you about.
  if (item.kind === "personal") return <CompactCard item={item} />;

  const Icon = KIND_ICON[item.kind] ?? Newspaper;
  const media = item.media;

  return (
    <Link
      href={item.url}
      className="group block overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/60 transition-colors hover:border-blood-500/40"
      style={media?.accent ? ({ ["--accent" as string]: media.accent }) : undefined}
    >
      <div className="relative aspect-video overflow-hidden bg-ink-850">
        {media?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        )}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/10 to-transparent" />

        {media?.promotionName && (
          <span
            className="absolute left-3 top-3 rounded-md bg-ink-950/80 px-2 py-1 font-display text-[0.6rem] font-bold uppercase tracking-wide text-chalk backdrop-blur"
            style={media.accent ? { boxShadow: `inset 0 0 0 1px ${media.accent}66` } : undefined}
          >
            {media.promotionName}
          </span>
        )}

        {/* Watermark only on borrowed imagery — our own artwork already carries
            the wordmark, and stacking two looks like a mistake. */}
        {media && !media.generated && (
          <span className="pointer-events-none absolute bottom-2 right-3 font-display text-[0.55rem] font-bold uppercase tracking-[0.15em] text-white/45">
            Combat Reviews
          </span>
        )}

        {item.meta && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-ink-950/75 px-2 py-1 text-[0.66rem] font-semibold text-chalk backdrop-blur">
            <Icon className="size-3 text-blood-400" />
            {item.meta}
          </span>
        )}
      </div>

      <div className="p-4">
        {item.reason && (
          <p className="mb-1 font-display text-[0.62rem] font-bold uppercase tracking-widest text-blood-400">
            {item.reason}
          </p>
        )}
        <h3 className="line-clamp-2 font-display text-base font-bold leading-snug text-chalk group-hover:text-blood-200">
          {item.title}
        </h3>
        {item.body && <p className="mt-1 line-clamp-2 text-[0.8rem] leading-relaxed text-mist">{item.body}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[0.7rem] text-fog">
          {media?.source && <span className="truncate">{media.source}</span>}
          {media?.source && <span aria-hidden>·</span>}
          <span>{timeAgo(new Date(item.at))}</span>
        </p>
      </div>
    </Link>
  );
}

function CompactCard({ item }: { item: FeedItem }) {
  return (
    <Link
      href={item.url}
      className={cn(
        "group flex items-start gap-3 rounded-2xl border border-ink-700 bg-ink-900/60 p-4",
        "transition-colors hover:border-blood-500/40",
      )}
    >
      <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-blood-500/12 text-base">
        {item.icon ?? "•"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-bold leading-snug text-chalk">{item.title}</span>
        {item.body && <span className="mt-0.5 block line-clamp-2 text-xs text-mist">{item.body}</span>}
        <span className="mt-1 block text-[0.68rem] text-fog">{timeAgo(new Date(item.at))}</span>
      </span>
    </Link>
  );
}
