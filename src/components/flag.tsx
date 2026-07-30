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
  code, name, size = "sm", className, title,
}: {
  code?: string | null;
  /**
   * Country NAME fallback, used when `code` is missing or unrecognised.
   *
   * This is why flags were blank on some event rows. Every caller passed only
   * `countryCode`, but that column is not reliably populated — a synthetic
   * "Boxing — 27 Jul 2026" card has no location at all, and an ingested event often
   * arrives with a country NAME ("Uruguay") and no ISO code. `toCountryCode` has
   * always accepted a full name, so the information needed to draw the flag was
   * usually sitting right there in `country`, already being rendered as text one
   * span away — the result was "Montevideo, Uruguay ▯", a visible name beside a grey
   * placeholder.
   *
   * Precedence is code-then-name because a code is unambiguous and a name needs a
   * lookup that can legitimately miss.
   */
  name?: string | null;
  size?: keyof typeof sizeMap;
  className?: string;
  title?: string;
}) {
  // Accept either an ISO-2 code or a full country name ("United States").
  const cc = toCountryCode(code) ?? toCountryCode(name);
  if (!cc) {
    return <span className={cn("inline-block rounded-[2px] bg-ink-700", sizeMap[size], className)} aria-hidden />;
  }
  return (
    <Image
      src={`https://flagcdn.com/${cc}.svg`}
      alt={title ?? name ?? code ?? ""}
      title={title ?? name ?? code ?? undefined}
      width={30}
      height={20}
      className={cn("inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-white/10", sizeMap[size], className)}
      unoptimized
    />
  );
}
