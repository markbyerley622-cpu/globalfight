import Image from "next/image";
import { cn } from "@/lib/utils";
import { toCountryCode } from "@/lib/countries";

// Crisp SVG flags (flagcdn) — flag emojis render as bare letters on Windows
// and are inconsistent across platforms, so we use real vector flags instead.
const sizeMap = {
  xs: "h-3 w-[1.125rem]",
  sm: "h-3.5 w-[1.3125rem]",
  md: "h-4 w-6",
  lg: "h-5 w-[1.875rem]",
} as const;

export function Flag({
  code, size = "sm", className, title,
}: {
  code?: string | null;
  size?: keyof typeof sizeMap;
  className?: string;
  title?: string;
}) {
  // Accept either an ISO-2 code or a full country name ("United States").
  const cc = toCountryCode(code);
  if (!cc) {
    return <span className={cn("inline-block rounded-[2px] bg-ink-700", sizeMap[size], className)} aria-hidden />;
  }
  return (
    <Image
      src={`https://flagcdn.com/${cc}.svg`}
      alt={title ?? code ?? ""}
      title={title ?? code ?? undefined}
      width={30}
      height={20}
      className={cn("inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-white/10", sizeMap[size], className)}
      unoptimized
    />
  );
}
