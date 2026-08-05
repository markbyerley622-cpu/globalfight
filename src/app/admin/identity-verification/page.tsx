import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listVerifications, verificationStats, roleLabel } from "@/lib/identity-verification";
import { REGISTRY_ROLE_DEFS } from "@/lib/roles";

export const dynamic = "force-dynamic";

// The admin layout already calls requireAdminPage(), which 404s for anyone who
// isn't staff — so this page cannot render for a non-admin. It reads the queue
// directly rather than through an API: there is no second consumer, and a
// server component keeps the storage keys strictly server-side by construction.

const STATUSES = ["PENDING", "APPROVED", "DECLINED", "RESUBMIT_REQUESTED"] as const;

const TONE: Record<string, "gold" | "volt" | "red" | "neutral"> = {
  PENDING: "gold",
  APPROVED: "volt",
  DECLINED: "red",
  RESUBMIT_REQUESTED: "neutral",
};

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export default async function IdentityVerificationQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; role?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as never) ? sp.status : undefined;
  const role = sp.role || undefined;
  const q = sp.q?.trim() || undefined;

  const [{ rows, total }, stats] = await Promise.all([
    listVerifications({ status, role, q, take: 100 }),
    verificationStats(),
  ]);

  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: status ?? "", role: role ?? "", q: q ?? "", ...next })) {
      if (v) p.set(k, v);
    }
    const s = p.toString();
    return s ? `/admin/identity-verification?${s}` : "/admin/identity-verification";
  };

  return (
    <div>
      <header className="mb-5 flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-blood-400" />
        <h1 className="font-display text-xl font-bold uppercase tracking-wide text-chalk">Identity verification</h1>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Pending review", value: String(stats.pending), accent: stats.pending > 0 },
          { label: "Approved today", value: String(stats.approvedToday) },
          { label: "Declined today", value: String(stats.declinedToday) },
          { label: `Avg review (last ${stats.sampleSize})`, value: fmtDuration(stats.avgReviewMs) },
        ].map((s) => (
          <div key={s.label} className="card-surface p-4">
            <dd className={`font-display text-2xl font-bold tabular-nums ${s.accent ? "text-gold-300" : "text-chalk"}`}>
              {s.value}
            </dd>
            <dt className="mt-0.5 text-2xs uppercase tracking-wide text-fog">{s.label}</dt>
          </div>
        ))}
      </dl>

      <form action="/admin/identity-verification" className="mb-3">
        {status && <input type="hidden" name="status" value={status} />}
        {role && <input type="hidden" name="role" value={role} />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name, username or email…"
          className="h-11 w-full rounded-lg border border-ink-700 bg-ink-900 px-3.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none"
        />
      </form>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <FilterLink href={qs({ status: "" })} active={!status}>All</FilterLink>
        {STATUSES.map((s) => (
          <FilterLink key={s} href={qs({ status: s })} active={status === s}>
            {s === "RESUBMIT_REQUESTED" ? "Resubmit" : s[0] + s.slice(1).toLowerCase()}
          </FilterLink>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        <FilterLink href={qs({ role: "" })} active={!role}>Any role</FilterLink>
        {REGISTRY_ROLE_DEFS.filter((r) => r.value !== "fan").map((r) => (
          <FilterLink key={r.value} href={qs({ role: r.value })} active={role === r.value}>{r.label}</FilterLink>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-fog">
          Nothing matches those filters.
        </p>
      ) : (
        <>
          <p className="mb-2 text-2xs uppercase tracking-wide text-fog">
            {rows.length} of {total}
          </p>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/identity-verification/${r.id}`}
                  className="flex items-center gap-3 rounded-card border border-ink-800 bg-ink-900 p-3.5 transition-colors hover:border-blood-500/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-display text-sm font-bold text-chalk">
                        {r.user.name ?? r.user.username ?? "Unnamed"}
                      </span>
                      <Badge tone={TONE[r.status] ?? "neutral"} size="sm">
                        {r.status === "RESUBMIT_REQUESTED" ? "Resubmit" : r.status}
                      </Badge>
                      <Badge tone="outline" size="sm">{roleLabel(r.role)}</Badge>
                      {r.attempt > 1 && <Badge tone="neutral" size="sm">Attempt {r.attempt}</Badge>}
                      {r.user.professionalVerifiedAt && <Badge tone="volt" size="sm">Verified</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-2xs text-fog">
                      {r.user.email} · {r._count.documents} document{r._count.documents === 1 ? "" : "s"} ·{" "}
                      {new Date(r.submittedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                      {r.reviewer && ` · reviewed by ${r.reviewer.name ?? r.reviewer.username}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
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
