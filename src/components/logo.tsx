import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Primary Combat Register brandmark. `sizeClass` controls the rendered height
// responsively (Tailwind h-* + w-auto).
//
// The width/height below are the file's TRUE intrinsic dimensions (507×350,
// ratio 1.4486). They used to read 150×100 (1.50) — a 3% mismatch, which is
// small enough to look fine and large enough that the browser reserved the wrong
// box and then squashed the mark by a pixel or two once it decoded. Lighthouse
// flags it as "Displays images with incorrect aspect ratio" on every page,
// because this component is in the header and the footer of all of them. These
// two numbers must match the file; they do not control the rendered size, which
// comes from `sizeClass`.
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
        width={507}
        height={350}
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
