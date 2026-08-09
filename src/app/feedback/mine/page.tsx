import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth";
import { myFeedback, CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE, isCategory, isStatus } from "@/lib/feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My feedback", robots: { index: false } };

/**
 * The member's own submissions.
 *
 * Scoped by `authorId` at the query — there is no id in the URL to tamper with,
 * so one person's list cannot be pointed at another's. Hidden items appear HERE
 * (and nowhere public) so the author is not left wondering where their post
 * went; the board itself excludes them.
 */
export default async function MyFeedbackPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/account");

  const rows = await myFeedback(user.id);
  const fmt = (d: Date) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="container-cr max-w-3xl py-6">
      <Link href="/feedback" className="tap mb-4 inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-fog transition-colors hover:text-chalk">
        <ArrowLeft className="size-3.5" aria-hidden /> The board
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-black text-chalk">My feedback</h1>
        <Link
          href="/feedback/new"
          className="tap inline-flex min-h-11 items-center gap-2 rounded-lg bg-blood-500 px-4 font-display text-2xs font-black uppercase tracking-wider text-white transition-colors hover:bg-blood-400"
        >
          <Plus className="size-4" aria-hidden /> New
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-ink-700 px-6 py-12 text-center">
          <p className="font-display text-sm font-bold text-chalk">You haven&apos;t posted anything yet</p>
          <p className="mt-1 text-sm text-fog">Anything you post shows up here with its status and vote count.</p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((r) => {
            const category = isCategory(r.category) ? CATEGORY_LABEL[r.category] : r.category;
            const status = isStatus(r.status) ? STATUS_LABEL[r.status] : r.status;
            const tone = isStatus(r.status) ? STATUS_TONE[r.status] : "neutral";
            return (
              <li key={r.id}>
                <Link
                  href={`/feedback/${r.id}`}
                  className="flex items-start gap-3 rounded-card border border-ink-800 bg-ink-900 p-3.5 transition-colors hover:border-ink-700"
                >
                  <span className="grid w-12 shrink-0 place-items-center rounded-lg border border-ink-700 bg-ink-850 py-1.5">
                    <span className="font-display text-sm font-black tabular-nums text-mist">{r._count.votes}</span>
                    <span className="text-4xs uppercase tracking-wider text-fog">votes</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-bold text-chalk">{r.title}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone="outline" size="sm">{category}</Badge>
                      <Badge tone={tone} size="sm">{status}</Badge>
                      {r.hiddenAt && <Badge tone="red" size="sm">Removed</Badge>}
                      <span className="text-2xs text-fog">{fmt(r.createdAt)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
