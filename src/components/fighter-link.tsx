import Link from "next/link";
import { isPlaceholderName, isPlaceholderSlug } from "@/lib/entities/placeholder";

/**
 * A fighter's name, linked to their profile — unless there is no fighter.
 *
 * Ingest creates a Fighter row for whatever a source puts in a corner, so "TBA"
 * and "Opponent TBA" have rows, slugs and profile pages. Every surface that
 * rendered a corner therefore linked the word "TBA" to a 0-0-0 profile of
 * nobody: on event cards, in the fight row, in the tale of the tape and in the
 * headline matchup. Four components, one wrong assumption — that a corner always
 * holds a person.
 *
 * This is the single place that assumption is checked. A placeholder renders as
 * plain text with the same styling, so the card still reads "Adesanya vs TBA"
 * and looks right; there is simply nothing to click, nothing to crawl, and no
 * dead profile behind it.
 *
 * `title` is intentionally dropped for placeholders — "TBA — fighter profile"
 * is a tooltip promising a page that does not exist.
 */
export function FighterLink({
  name,
  slug,
  className,
  title,
  children,
}: {
  name: string;
  slug: string;
  className?: string;
  title?: string;
  /** Defaults to the name; pass children when the name needs inner markup. */
  children?: React.ReactNode;
}) {
  const body = children ?? name;
  if (isPlaceholderName(name) || isPlaceholderSlug(slug)) {
    return <span className={className}>{body}</span>;
  }
  return (
    <Link href={`/fighters/${slug}`} className={className} title={title}>
      {body}
    </Link>
  );
}
