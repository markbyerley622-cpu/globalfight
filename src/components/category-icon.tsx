import {
  Newspaper, BarChart3, TrendingUp, Trophy, Target, Megaphone,
  Swords, Calendar, History, MessageCircle, Radio, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { communityIcon } from "@/components/icons/community-icons";

// Single source of truth: map a news/forum category name to a Lucide icon.
const ICONS: Record<string, LucideIcon> = {
  // News
  "Breaking News": Radio,
  "Fight Announcements": Megaphone,
  "Rankings": TrendingUp,
  "Championships": Trophy,
  "Predictions": Target,
  "Analysis": BarChart3,
  // Forums
  "General Boxing": Swords,
  "Fight Predictions": Target,
  "News Discussion": Newspaper,
  "Upcoming Events": Calendar,
  "Historical Boxing": History,
  "Off Topic": MessageCircle,
};

export function categoryIcon(name: string): LucideIcon {
  return ICONS[name] ?? Newspaper;
}

// Resolve, in order: a bespoke Combat Reviews community glyph (matched by slug
// or display name — see community-icons.tsx), then the lucide news/forum map,
// then a Newspaper fallback. Community glyphs and lucide icons share the same
// `className` API, so the call site controls size + colour either way.
export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Community = communityIcon(name);
  if (Community) return <Community className={className} />;
  const Icon = categoryIcon(name);
  return <Icon className={cn("size-4", className)} />;
}
