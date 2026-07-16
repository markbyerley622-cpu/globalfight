import { Megaphone, Trophy, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

// Visual treatment for fighter/promoter posts and announcements so they read as
// distinct from regular discussion in the feed and on the thread page.
const KIND: Record<string, { label: string; icon: typeof Trophy; tone: string }> = {
  fighter_post: { label: "Fighter Post", icon: Trophy, tone: "bg-blood-500/15 text-blood-300 border-blood-500/30" },
  promoter_post: { label: "Promoter", icon: Ticket, tone: "bg-gold-500/15 text-gold-300 border-gold-500/30" },
  announcement: { label: "Announcement", icon: Megaphone, tone: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
};

export function KindBadge({ kind, className }: { kind: string; className?: string }) {
  const meta = KIND[kind];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider", meta.tone, className)}>
      <Icon className="size-3" /> {meta.label}
    </span>
  );
}
