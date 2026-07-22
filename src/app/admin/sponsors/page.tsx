import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, LinkIcon, Clock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { SPONSORS, isLive, sponsorHref, daysUntilExpiry } from "@/lib/sponsors";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sponsors", robots: { index: false } };
export const dynamic = "force-dynamic";

const EXPIRY_WARNING_DAYS = 45;

/**
 * Sponsor status — READ ONLY, and deliberately so.
 *
 * A partner mark is a contractual asset: who approved it, under which
 * agreement, and for what window has to be attributable and revertible. Keeping
 * the list in `src/lib/sponsors.ts` means every change is a reviewed commit.
 * A CMS form would trade that for an audit trail nobody reads and a rollback
 * nobody has.
 *
 * What an admin genuinely needs from a screen is to SEE state: what is live,
 * what lapses soon, and which partners are rendering without a destination.
 * That is what this is. Editing is a pull request.
 */
export default async function AdminSponsorsPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !isAdminRole(user.role)) notFound();

  const now = new Date();
  const rows = SPONSORS.map((s) => ({
    sponsor: s,
    live: isLive(s, now),
    href: sponsorHref(s),
    days: daysUntilExpiry(s, now),
  }));

  const live = rows.filter((r) => r.live).length;
  const unlinked = rows.filter((r) => r.live && !r.href).length;
  const expiringSoon = rows.filter((r) => r.live && r.days <= EXPIRY_WARNING_DAYS).length;

  return (
    <div className="container-cr py-8">
      <h1 className="font-display text-2xl font-black uppercase tracking-tight text-chalk">Sponsors</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fog">
        Defined in <code className="rounded bg-ink-850 px-1 py-0.5 text-[0.8em] text-mist">src/lib/sponsors.ts</code>.
        This page reports what is live; changes go through a commit so every partner mark stays attributable to an
        approver and an agreement.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Configured" value={SPONSORS.length} />
        <Stat label="Live now" value={live} />
        <Stat label="No destination" value={unlinked} tone={unlinked > 0 ? "warn" : undefined} />
        <Stat label={`Lapse < ${EXPIRY_WARNING_DAYS}d`} value={expiringSoon} tone={expiringSoon > 0 ? "warn" : undefined} />
      </div>

      <ul className="mt-5 flex flex-col gap-2">
        {rows.map(({ sponsor: s, live: isActive, href, days }) => (
          <li
            key={s.id}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-2xl border bg-ink-900 p-4",
              isActive ? "border-ink-800" : "border-ink-800 opacity-60",
            )}
          >
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-ink-700 bg-ink-950">
              <Image src={s.logo} alt="" width={48} height={48} className="size-full object-contain p-1" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-display text-sm font-bold text-chalk">{s.name}</span>
                <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-fog">
                  {s.category}
                </span>
                {s.featured && (
                  <span className="rounded bg-gold-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-gold-300">
                    Featured
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[0.72rem] text-fog">
                {s.legalName !== s.name && <>{s.legalName} · </>}
                {s.agreementRef} · approved by {s.approvedBy}
              </span>
              <span className="mt-0.5 block text-[0.72rem] text-fog">
                {s.startDate} → {s.endDate}
                {isActive && Number.isFinite(days) && (
                  <span className={cn(days <= EXPIRY_WARNING_DAYS ? "text-gold-300" : "text-fog")}>
                    {" "}· {days} day{days === 1 ? "" : "s"} left
                  </span>
                )}
              </span>
            </span>

            <span className="flex shrink-0 flex-col items-end gap-1.5">
              {isActive ? (
                <Badge tone="ok" icon={<CheckCircle2 className="size-3" />}>Live</Badge>
              ) : (
                <Badge tone="off" icon={<Clock className="size-3" />}>
                  {s.active ? "Out of window" : "Disabled"}
                </Badge>
              )}

              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[0.7rem] text-volt-400 underline-offset-2 hover:underline"
                >
                  {href.replace(/^https?:\/\//, "").slice(0, 32)} <ExternalLink className="size-3" />
                </a>
              ) : (
                <Badge tone="warn" icon={<LinkIcon className="size-3" />}>No destination</Badge>
              )}
            </span>
          </li>
        ))}
      </ul>

      {unlinked > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-2xl border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-[0.78rem] leading-relaxed text-gold-300">
          <AlertTriangle className="mt-px size-4 shrink-0" />
          {unlinked} live partner{unlinked === 1 ? " has" : "s have"} no confirmed destination. Their marks render
          unlinked — not pointed at the homepage — until a real URL is agreed. Add it to{" "}
          <code className="rounded bg-ink-950/50 px-1">sponsors.ts</code> and ship.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900 px-3 py-2.5">
      <p className={cn("font-display text-xl font-black tabular-nums", tone === "warn" ? "text-gold-300" : "text-chalk")}>
        {value}
      </p>
      <p className="mt-0.5 text-[0.62rem] uppercase tracking-wider text-fog">{label}</p>
    </div>
  );
}

function Badge({
  tone, icon, children,
}: { tone: "ok" | "warn" | "off"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-display text-[0.6rem] font-bold uppercase tracking-wider",
        tone === "ok" ? "bg-up/15 text-up" : tone === "warn" ? "bg-gold-500/15 text-gold-300" : "bg-ink-800 text-fog",
      )}
    >
      {icon} {children}
    </span>
  );
}
