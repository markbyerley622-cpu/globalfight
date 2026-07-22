import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Primary Combat Register brandmark. `sizeClass` controls the rendered height
// responsively (Tailwind h-* + w-auto); intrinsic ratio ~3:2.
export function Logo({
  className, sizeClass = "h-10 sm:h-12", href = "/", showWordmark = true, priority = false,
}: {
  className?: string;
  sizeClass?: string;
  href?: string | null;
  showWordmark?: boolean;
  priority?: boolean;
}) {
  const mark = (
    <span className="flex items-center gap-3">
      <Image
        src="/cr-logo.png"
        alt="Combat Reviews"
        width={150}
        height={100}
        priority={priority}
        className={cn("w-auto drop-shadow-[0_2px_10px_rgba(225,29,42,0.25)]", sizeClass)}
      />
      {showWordmark && (
        <span className="hidden font-display text-xl font-bold uppercase leading-none tracking-tight text-chalk sm:text-2xl md:block">
          Combat<span className="text-blood-500">Reviews</span>
        </span>
      )}
    </span>
  );

  if (href === null) return <span className={cn("inline-flex", className)}>{mark}</span>;
  return (
    <Link href={href} className={cn("inline-flex items-center", className)} aria-label="Combat Reviews home">
      {mark}
    </Link>
  );
}
