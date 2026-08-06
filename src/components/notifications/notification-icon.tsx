import {
  AtSign, Award, Ban, BadgeCheck, Bell, Calendar, CalendarClock, CheckCircle2, ClipboardList,
  Dumbbell, Flame, Handshake, Heart, Layers, Medal, Megaphone, MessageSquare, Mic, Newspaper,
  Pencil, Play, Radio, Share2, Star, Swords, Trash2, TrendingDown, TrendingUp, Trophy, User,
  UserPlus, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  notificationIconKey, iconTone, type NotificationIconKey,
} from "@/lib/notification-icons";

// ════════════════════════════════════════════════════════════════════════════
//  A notification's icon, as a real icon.
//
//  Every glyph is a Lucide stroke icon, so it inherits currentColor, scales to any
//  size, stays crisp at any DPR (it is a vector, so "Retina" is not a special case)
//  and looks like the rest of the product. See lib/notification-icons for why the
//  stored value is a key rather than an emoji.
// ════════════════════════════════════════════════════════════════════════════

/** Key → component. The compiler requires an entry for every key. */
const ICONS: Record<NotificationIconKey, typeof Bell> = {
  victory: Trophy,
  defeat: XCircle,
  correct: CheckCircle2,
  missed: XCircle,

  fight: Swords,
  cancelled: Ban,
  rescheduled: CalendarClock,
  scheduled: Calendar,
  live: Radio,
  results: ClipboardList,

  ranking: TrendingUp,
  rankingUp: TrendingUp,
  rankingDown: TrendingDown,

  gym: Dumbbell,
  review: Star,
  edit: Pencil,
  removed: Trash2,

  community: Handshake,
  reply: MessageSquare,
  mention: AtSign,
  person: User,
  follow: UserPlus,
  verified: BadgeCheck,
  reaction: Heart,
  share: Share2,

  announcement: Megaphone,
  promotion: Award,
  video: Play,
  news: Newspaper,
  podcast: Mic,

  streak: Flame,
  card: Layers,
  reputation: Star,
  milestone: Medal,
  welcome: Handshake,

  bell: Bell,
};

/**
 * Tone → colour. Deliberately restrained: the icon is a supporting signal beside
 * the title, and a wall of green ticks and red crosses in a list reads as an error
 * log rather than a feed.
 */
const TONE_CLASS = {
  positive: "text-volt-400",
  negative: "text-fog",
  neutral: "text-mist",
} as const;

export function NotificationIcon({
  notification,
  className,
}: {
  notification: { icon?: string | null; type?: string | null };
  className?: string;
}) {
  const key = notificationIconKey(notification);
  const Icon = ICONS[key];
  const tone = iconTone(key);

  return (
    <span
      // The icon repeats information already in the title ("Ada def. Bo" next to a
      // trophy), so it is decorative and hidden from screen readers rather than
      // announced as "trophy" before every row.
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg border border-ink-800 bg-ink-850/70",
        // Subtle, and motion-safe so a reduced-motion reader gets no transition at
        // all rather than a shortened one.
        "motion-safe:transition-colors motion-safe:duration-200",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={2} />
    </span>
  );
}
