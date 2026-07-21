import Link from "next/link";
import { prisma } from "@/lib/db";
import { resolvePromotion } from "@/lib/promotions";
import { formatDate } from "@/lib/utils";
import { NewEventButton } from "@/components/admin/new-event-button";

export const dynamic = "force-dynamic";
const PER_PAGE = 40;

/** Operations event list. Drafts FIRST — they are the ones needing work. */
export default async function AdminEventsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(0, Number(sp.page) - 1) || 0;

  const where = {
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(sp.status ? { status: sp.status as never } : {}),
  };

  const [rows, total, draftCount] = await Promise.all([
    prisma.event.findMany({
      where,
      // Drafts to the top, then soonest first: the work queue, not a catalogue.
      orderBy: [{ status: "asc" }, { date: "desc" }],
      skip: page * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true, slug: true, name: true, date: true, status: true, promotion: true,
        venue: true, city: true, lockedFields: true, _count: { select: { fights: true } },
      },
    }),
    prisma.event.count({ where }),
    prisma.event.count({ where: { status: "DRAFT" } }),
  ]);

  const statuses = ["", "DRAFT", "ANNOUNCED", "SCHEDULED", "LIVE", "COMPLETED", "CANCELLED", "POSTPONED"];

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-lg font-bold text-chalk">Events</h1>
        <span className="text-xs text-fog">{total.toLocaleString()} total · {draftCount} draft</span>
        <div className="ml-auto flex items-center gap-2">
          <form className="flex items-center gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search events…"
              className="w-56 rounded-md border border-ink-700 bg-ink-950/60 px-2.5 py-1.5 text-sm text-chalk outline-none placeholder:text-ink-600 focus:border-blood-500/60"
            />
            {sp.status && <input type="hidden" name="status" value={sp.status} />}
          </form>
          <NewEventButton />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {statuses.map((s) => {
          const active = (sp.status ?? "") === s;
          const href = s ? `/admin/events?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}` : `/admin/events${q ? `?q=${encodeURIComponent(q)}` : ""}`;
          return (
            <Link
              key={s || "all"}
              href={href}
              className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold transition-colors ${
                active ? "border-blood-500 bg-blood-500 text-white" : "border-ink-700 text-fog hover:text-chalk"
              }`}
            >
              {s || "All"}
            </Link>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border border-ink-800">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-ink-800 bg-ink-900/60 text-left text-[0.68rem] uppercase tracking-wide text-fog">
              <th className="px-3 py-2 font-semibold">Event</th>
              <th className="px-3 py-2 font-semibold">Promotion</th>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Location</th>
              <th className="px-3 py-2 text-right font-semibold">Bouts</th>
              <th className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-ink-800/60 transition-colors last:border-0 hover:bg-ink-900/50">
                <td className="px-3 py-2">
                  <Link href={`/admin/events/${e.id}`} className="font-semibold text-chalk hover:text-blood-300">
                    {e.name}
                  </Link>
                  {e.lockedFields.length > 0 && (
                    <span className="ml-2 text-[0.65rem] text-gold-400" title={`Held from automated updates: ${e.lockedFields.join(", ")}`}>
                      {e.lockedFields.length} held
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-mist">{resolvePromotion(e.promotion).name}</td>
                <td className="px-3 py-2 tabular-nums text-mist">{formatDate(e.date.toISOString(), { month: "short", day: "numeric", year: "numeric" })}</td>
                <td className="truncate px-3 py-2 text-fog">{[e.venue, e.city].filter(Boolean).join(", ") || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-mist">{e._count.fights}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold ${
                    e.status === "DRAFT" ? "bg-gold-500/15 text-gold-300"
                    : e.status === "LIVE" ? "bg-blood-500/20 text-blood-300"
                    : e.status === "CANCELLED" || e.status === "POSTPONED" ? "bg-ink-800 text-fog"
                    : "bg-ink-800 text-mist"}`}>
                    {e.status}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-fog">No events match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PER_PAGE && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {page > 0 && <Link href={`/admin/events?page=${page}`} className="rounded border border-ink-700 px-2 py-1 text-fog hover:text-chalk">← Prev</Link>}
          <span className="text-fog">Page {page + 1} of {Math.ceil(total / PER_PAGE)}</span>
          {(page + 1) * PER_PAGE < total && <Link href={`/admin/events?page=${page + 2}`} className="rounded border border-ink-700 px-2 py-1 text-fog hover:text-chalk">Next →</Link>}
        </div>
      )}
    </div>
  );
}
