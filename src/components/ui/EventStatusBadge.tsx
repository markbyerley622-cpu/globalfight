import { Badge } from "./Badge";
import { LiveDot } from "./LiveDot";
import type { EventStatus } from "@/lib/domain/types";

const CONFIG: Record<EventStatus, { label: string; tone: Parameters<typeof Badge>[0]["tone"] }> = {
  announced: { label: "Announced", tone: "outline" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  live: { label: "Live", tone: "live" },
  completed: { label: "Final", tone: "success" },
  cancelled: { label: "Cancelled", tone: "warning" },
  postponed: { label: "Postponed", tone: "warning" },
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const { label, tone } = CONFIG[status];
  return (
    <Badge tone={tone}>
      {status === "live" ? <LiveDot /> : null}
      {label}
    </Badge>
  );
}
