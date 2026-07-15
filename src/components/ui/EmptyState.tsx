import { cn } from "@/lib/utils";

/**
 * Shared empty / unavailable / error placeholder. Every list surface uses this
 * so blank states stay consistent and intentional rather than showing nothing.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "empty",
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  tone?: "empty" | "error" | "unavailable";
  className?: string;
}) {
  const toneRing =
    tone === "error"
      ? "border-brand/40"
      : tone === "unavailable"
        ? "border-warning/30"
        : "border-border";
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center",
        toneRing,
        className,
      )}
    >
      {icon ? <div className="text-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="max-w-xs text-xs text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
