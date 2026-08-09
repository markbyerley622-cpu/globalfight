import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { requireAdminPage } from "@/lib/admin/guard";
import {
  listForStaff, feedbackStats, STATUSES, CATEGORIES,
  CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE, isCategory, isStatus,
} from "@/lib/feedback";
import { FeedbackAdminRow } from "@/components/feedback/feedback-admin-row";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN → Operations → Feedback.
//
//  Guarded HERE, in the page body, not only by the admin layout. That is the
//  bug this codebase already shipped once: a layout and its page render in
//  parallel, so `notFound()` upstairs replaces the UI while the page has
//  already run its queries and streamed the results. This page reads the
//  STAFF-ONLY note, so it is exactly the kind that must not.
// ════════════════════════════════════════════════════════════════════════════

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; q?: string; page?: string }>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const [{ rows, total, page, pages }, stats] = await Promise.all([
    listForStaff({
      status: sp.status,
      category: sp.category,
      q: sp.q?.trim() || undefined,
      page: Number(sp.page) || 1,
    }),
    feedbackStats(),
  ]);

  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: sp.status ?? "", category: sp.category ?? "", q: sp.q ?? "", ...next })) {
      if (v) p.set(k, v);
    }
    const s = p.toString();
    return s ? `/admin/feedback?${s}` : "/admin/feedback";
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex items-center gap-2.5">
        <MessageSquarePlus className="size-5 text-blood-400" />
        <h1 className="font-display text-xl font-bold uppercase tracking-wide text-chalk">Feedback</h1>
        <Link href="/feedback" className="ml-auto text-2xs text-fog hover:text-chalk">View public board ↗</Link>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Open", value: stats.open, accent: stats.open > 0 },
          { label: "Planned", value: stats.planned },
          { label: "In progress", value: stats.inProgress },
          { label: "Completed", value: stats.completed },
          { label: "Declined", value: stats.declined },
        ].map((s) => (
          <div key={s.label} className="rounded-card border border-ink-800 bg-ink-900 p-4">
            <dd className={`font-display text-2xl font-bold tabular-nums ${s.accent ? "text-gold-300" : "text-chalk"}`}>
              {s.value}
            </dd>
            <dt className="mt-0.5 text-2xs uppercase tracking-wide text-fog">{s.label}</dt>
          </div>
        ))}
      </dl>

      <form action="/admin/feedback" className="mb-3">
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
        <label htmlFor="admin-fb-q" className="sr-only">Search feedback</label>
        <input
          id="admin-fb-q"
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search titles…"
          className="h-11 w-full rounded-lg border border-ink-700 bg-ink-900 px-3.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none"
        />
      </form>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <Filter href={qs({ status: "" })} active={!sp.status}>All</Filter>
        {STATUSES.map((s) => (
          <Filter key={s} href={qs({ status: s })} active={sp.status === s}>{STATUS_LABEL[s]}</Filter>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        <Filter href={qs({ category: "" })} active={!sp.category}>Any type</Filter>
        {CATEGORIES.map((c) => (
          <Filter key={c} href={qs({ category: c })} active={sp.category === c}>{CATEGORY_LABEL[c]}</Filter>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-fog">
          Nothing matches those filters.
        </p>
      ) : (
        <>
          <p className="mb-2 text-2xs uppercase tracking-wide text-fog">{rows.length} of {total}</p>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id}>
                <FeedbackAdminRow
                  item={{
                    id: r.id,
                    title: r.title,
                    body: r.body,
                    category: isCategory(r.category) ? CATEGORY_LABEL[r.category] : r.category,
                    status: r.status,
                    statusLabel: isStatus(r.status) ? STATUS_LABEL[r.status] : r.status,
                    tone: isStatus(r.status) ? STATUS_TONE[r.status] : "neutral",
                    publicNote: r.publicNote,
                    adminNote: r.adminNote,
                    hidden: Boolean(r.hiddenAt),
                    votes: r._count.votes,
                    author: r.author?.username ?? null,
                    createdAt: r.createdAt.toISOString(),
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-2">
          {page > 1 && <Link href={qs({ page: String(page - 1) })} className="tap rounded-lg border border-ink-700 px-4 py-2 text-xs text-mist">Previous</Link>}
          <span className="text-2xs uppercase tracking-wide text-fog">Page {page} of {pages}</span>
          {page < pages && <Link href={qs({ page: String(page + 1) })} className="tap rounded-lg border border-ink-700 px-4 py-2 text-xs text-mist">Next</Link>}
        </nav>
      )}
    </div>
  );
}

function Filter({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`tap rounded-full border px-3 py-1.5 font-display text-2xs font-bold uppercase tracking-wide transition-colors ${
        active ? "border-blood-500 bg-blood-500/15 text-blood-300" : "border-ink-700 bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk"
      }`}
    >
      {children}
    </Link>
  );
}
