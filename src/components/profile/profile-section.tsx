import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The frame every profile section shares.
 *
 * Exists so Current Picks, Recent Results and the sections that follow
 * (Activity, Statistics, Achievements) cannot each invent their own heading
 * rhythm — which is exactly what happened to the event page before its sections
 * were centralised. One `<h2>`, one count chip, one "View all", one spacing.
 *
 * `<section aria-labelledby>` rather than a bare div: these are the landmarks a
 * screen-reader user navigates a profile by, and an unlabelled region is one
 * they have to enter to identify.
 */
export function ProfileSection({
  title, icon, count, viewAll, isSelf, children,
}: {
  title: string;
  icon?: React.ReactNode;
  /** Shown beside the title when there is something to count. */
  count?: number;
  viewAll?: { href: string; label: string };
  /** "View all" is only meaningful on your own profile — /predictions/mine is
   *  the signed-in member's own record and would be the wrong destination from
   *  someone else's page. */
  isSelf?: boolean;
  children: React.ReactNode;
}) {
  const id = `profile-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-blood-400" aria-hidden>{icon}</span>}
        <h2 id={id} className="font-display text-sm font-black uppercase tracking-[0.18em] text-chalk">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-ink-800 px-2 py-0.5 text-3xs font-bold tabular-nums text-fog">
            {count}
          </span>
        )}
        {viewAll && isSelf && (
          <Link
            href={viewAll.href}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-2xs font-semibold text-fog transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            {viewAll.label} <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
