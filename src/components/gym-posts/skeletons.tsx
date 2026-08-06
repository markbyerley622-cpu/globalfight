// ════════════════════════════════════════════════════════════════════════════
//  Loading placeholders.
//
//  Shaped like the card they replace — same avatar size, same line heights,
//  same media box — so the layout does not jump when real content arrives. A
//  spinner would be less code and would move everything on screen the moment it
//  resolved, which is the jank these exist to prevent.
//
//  `aria-hidden` and no live region: a screen reader should hear the posts when
//  they land, not a description of grey rectangles. The container that owns the
//  fetch announces busy state instead.
// ════════════════════════════════════════════════════════════════════════════

const shimmer = "animate-pulse rounded bg-ink-800";

export function PostSkeleton({ withMedia = true }: { withMedia?: boolean }) {
  return (
    <article className="card-surface p-4" aria-hidden>
      <div className="flex items-center gap-3">
        <span className={`${shimmer} size-9 rounded-full`} />
        <span className="min-w-0 flex-1">
          <span className={`${shimmer} block h-3 w-32`} />
          <span className={`${shimmer} mt-1.5 block h-2.5 w-20`} />
        </span>
      </div>
      <div className="mt-3 space-y-2">
        <span className={`${shimmer} block h-3 w-full`} />
        <span className={`${shimmer} block h-3 w-4/5`} />
      </div>
      {withMedia && <span className={`${shimmer} mt-3 block aspect-[4/3] w-full rounded-card`} />}
      <div className="mt-3 flex gap-4">
        <span className={`${shimmer} h-3 w-14`} />
        <span className={`${shimmer} h-3 w-14`} />
        <span className={`${shimmer} h-3 w-14`} />
      </div>
    </article>
  );
}

/** A first paint. Three cards is enough to read as "a feed is coming". */
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        // Alternating media presence so the placeholder does not read as a
        // repeating pattern, which is what makes a skeleton look fake.
        <PostSkeleton key={i} withMedia={i % 2 === 0} />
      ))}
    </div>
  );
}

export function CommentSkeleton() {
  return (
    <div className="flex gap-2.5 py-2" aria-hidden>
      <span className={`${shimmer} size-7 shrink-0 rounded-full`} />
      <span className="min-w-0 flex-1">
        <span className={`${shimmer} block h-2.5 w-24`} />
        <span className={`${shimmer} mt-1.5 block h-3 w-3/4`} />
      </span>
    </div>
  );
}
