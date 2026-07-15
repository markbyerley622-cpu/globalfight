import { cn } from "@/lib/utils";

/**
 * Country flag from an ISO 3166-1 alpha-2 code, rendered as a Unicode
 * regional-indicator emoji. Combat Register uses flagcdn SVGs (crisper on
 * Windows) — for this self-contained skeleton we avoid the external image
 * dependency and use emoji, which render well on the target (macOS) demo.
 */
export function Flag({
  code,
  className,
  title,
}: {
  code?: string | null;
  className?: string;
  title?: string;
}) {
  const cc = code?.trim().toUpperCase();
  if (!cc || cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) {
    return <span className={cn("inline-block h-3 w-[1.125rem] rounded-[2px] bg-ink-700", className)} aria-hidden />;
  }
  const emoji = String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  return (
    <span className={cn("inline-block leading-none", className)} title={title ?? cc} aria-hidden>
      {emoji}
    </span>
  );
}
