import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquarePlus, Plus } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { getCurrentUser } from "@/lib/auth";
import { listFeedback, CATEGORIES, STATUSES, CATEGORY_LABEL, STATUS_LABEL, type Sort } from "@/lib/feedback";
import { FeedbackCard } from "@/components/feedback/feedback-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feedback",
  description: "Suggest ideas, report problems and vote on what Combat Reviews builds next.",
};

// ════════════════════════════════════════════════════════════════════════════
//  The public board.
//
//  PUBLIC READ, authenticated write — anyone may browse and see what the
//  community is asking for; voting and submitting need an account. That split
//  is the whole point: the board is an argument for signing up, so hiding it
//  behind a login would remove its best property.
//
//  The viewer's id is used ONLY to mark rows they have already voted for. It
//  never changes which rows come back.
// ════════════════════════════════════════════════════════════════════════════

const SORTS: { id: Sort; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "new", label: "Newest" },
  { id: "updated", label: "Recently updated" },
];

export default async function FeedbackBoard({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string; sort?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const sort = (SORTS.find((s) => s.id === sp.sort)?.id ?? "top") as Sort;
  const page = Number(sp.page) || 1;

  const { rows, total, pages } = await listFeedback({
    category: sp.category,
    status: sp.status,
    q: sp.q?.trim() || undefined,
    sort,
    page,
    viewerId: user?.id ?? null,
  });

  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { category: sp.category ?? "", status: sp.status ?? "", sort, q: sp.q ?? "", ...next };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "sort" && v === "top")) p.set(k, v);
    const s = p.toString();
    return s ? `/feedback?${s}` : "/feedback";
  };

  return (
    <>
      <PageHero
        eyebrow="Community"
        title="Feedback"
        description="Help shape Combat Reviews. Suggest ideas, report problems, and vote on what matters most to you — the board is public, and what rises to the top is what we look at first."
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href="/feedback/new"
            className="tap inline-flex min-h-11 items-center gap-2 rounded-lg bg-blood-500 px-4 font-display text-2xs font-black uppercase tracking-wider text-white transition-colors hover:bg-blood-400"
          >
            <Plus className="size-4" aria-hidden /> Submit feedback
          </Link>
          {user && (
            <Link
              href="/feedback/mine"
              className="tap inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-4 font-display text-2xs font-bold uppercase tracking-wider text-mist transition-colors hover:border-ink-600 hover:text-chalk"
            >
              My feedback
            </Link>
          )}
        </div>
      </PageHero>

      <div className="container-cr pb-12 pt-6">
        <form action="/feedback" className="mb-4">
          {sp.category && <input type="hidden" name="category" value={sp.category} />}
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <label htmlFor="feedback-q" className="sr-only">Search feedback</label>
          <input
            id="feedback-q"
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search the board…"
            className="h-11 w-full rounded-lg border border-ink-700 bg-ink-900 px-3.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none focus:ring-2 focus:ring-blood-500/40"
          />
        </form>

        <nav aria-label="Filter by category" className="mb-2 flex flex-wrap gap-1.5">
          <Chip href={qs({ category: "" })} active={!sp.category}>All</Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c} href={qs({ category: c })} active={sp.category === c}>{CATEGORY_LABEL[c]}</Chip>
          ))}
        </nav>
        <nav aria-label="Filter by status" className="mb-2 flex flex-wrap gap-1.5">
          <Chip href={qs({ status: "" })} active={!sp.status}>Any status</Chip>
          {STATUSES.map((s) => (
            <Chip key={s} href={qs({ status: s })} active={sp.status === s}>{STATUS_LABEL[s]}</Chip>
          ))}
        </nav>
        <nav aria-label="Sort" className="mb-5 flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <Chip key={s.id} href={qs({ sort: s.id })} active={sort === s.id}>{s.label}</Chip>
          ))}
        </nav>

        {rows.length === 0 ? (
          <div className="rounded-card border border-dashed border-ink-700 px-6 py-12 text-center">
            <MessageSquarePlus className="mx-auto size-7 text-fog" aria-hidden />
            <p className="mt-3 font-display text-sm font-bold text-chalk">
              {sp.q || sp.category || sp.status ? "Nothing matches that" : "Nobody has posted yet"}
            </p>
            <p className="mt-1 text-sm text-fog">
              {sp.q || sp.category || sp.status
                ? "Try a broader filter, or post it yourself."
                : "Be the first — tell us what would make this better."}
            </p>
            <Link
              href="/feedback/new"
              className="tap mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blood-500 px-4 font-display text-2xs font-black uppercase tracking-wider text-white transition-colors hover:bg-blood-400"
            >
              <Plus className="size-4" aria-hidden /> Submit feedback
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-2 text-2xs uppercase tracking-wide text-fog">
              {total} item{total === 1 ? "" : "s"}
            </p>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <FeedbackCard item={r} canVote={Boolean(user)} />
                </li>
              ))}
            </ul>
          </>
        )}

        {pages > 1 && (
          <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link href={qs({ page: String(page - 1) })} className="tap rounded-lg border border-ink-700 px-4 py-2 text-xs font-semibold text-mist hover:text-chalk">
                Previous
              </Link>
            )}
            <span className="text-2xs uppercase tracking-wide text-fog">Page {page} of {pages}</span>
            {page < pages && (
              <Link href={qs({ page: String(page + 1) })} className="tap rounded-lg border border-ink-700 px-4 py-2 text-xs font-semibold text-mist hover:text-chalk">
                Next
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`tap rounded-full border px-3 py-1.5 font-display text-2xs font-bold uppercase tracking-wide transition-colors ${
        active
          ? "border-blood-500 bg-blood-500/15 text-blood-300"
          : "border-ink-700 bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk"
      }`}
    >
      {children}
    </Link>
  );
}
