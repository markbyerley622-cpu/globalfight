import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ShieldCheck, MapPin, Dumbbell, Landmark, Scale, Trophy } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Pager } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { listFighters, getUpcomingEvents, getResults } from "@/lib/repo";
import { REGISTRY_SEED, ORG_TYPE_LABEL, type OrgType, type RegistryOrg } from "@/lib/data/registry";
import { NATIONAL_FEDERATIONS } from "@/lib/data/federations.generated";

export const metadata: Metadata = {
  title: "Registry",
  description:
    "The combat-sports ecosystem registry — federations, commissions, sanctioning bodies, promoters, gyms, venues and the people who power the sport. Every entry is source-backed.",
};

export const revalidate = 300;

type Tab = { key: OrgType | "all"; label: string; icon: typeof Building2 };
const TABS: Tab[] = [
  { key: "all", label: "All", icon: Building2 },
  { key: "federation", label: "Federations", icon: Landmark },
  { key: "commission", label: "Commissions", icon: Scale },
  { key: "sanctioning", label: "Sanctioning", icon: Trophy },
  { key: "promotion", label: "Promoters", icon: ShieldCheck },
  { key: "gym", label: "Gyms", icon: Dumbbell },
  { key: "venue", label: "Venues", icon: MapPin },
];

const ICON: Record<OrgType, typeof Building2> = {
  sanctioning: Trophy, federation: Landmark, commission: Scale,
  promotion: ShieldCheck, gym: Dumbbell, venue: MapPin, media: Building2,
};

function statusTone(s: RegistryOrg["status"]) {
  return s === "official" ? "gold" : s === "verified" ? "volt" : s === "claimed" ? "red" : "neutral";
}

export default async function RegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const { type, page: pageStr } = await searchParams;
  const active = (TABS.find((t) => t.key === type)?.key ?? "all") as Tab["key"];
  const page = Math.max(0, Number(pageStr) - 1) || 0;

  const [fighters, upcoming, results] = await Promise.all([
    listFighters(),
    getUpcomingEvents(),
    getResults(),
  ]);
  const events = [...upcoming, ...results];

  // ── Derive real organisations from the data we already hold ────────────
  const gyms = new Map<string, number>();
  const promoters = new Map<string, number>();
  for (const f of fighters) {
    if (f.gym) gyms.set(f.gym, (gyms.get(f.gym) ?? 0) + 1);
    if (f.promoter) promoters.set(f.promoter, (promoters.get(f.promoter) ?? 0) + 1);
  }
  const venues = new Map<string, { count: number; place?: string }>();
  for (const e of events) {
    if (e.promotion) promoters.set(e.promotion, (promoters.get(e.promotion) ?? 0) + 1);
    if (e.venue) {
      const prev = venues.get(e.venue);
      venues.set(e.venue, { count: (prev?.count ?? 0) + 1, place: [e.city, e.country].filter(Boolean).join(", ") });
    }
  }

  const derived: RegistryOrg[] = [
    ...[...gyms.entries()].map(([name, n]): RegistryOrg => ({
      id: `gym-${name}`, name, type: "gym", sports: [], confidence: 60, status: "unverified",
      note: `${n} fighter${n === 1 ? "" : "s"} on record`,
    })),
    ...[...promoters.entries()].map(([name, n]): RegistryOrg => ({
      id: `promo-${name}`, name, type: "promotion", sports: [], confidence: 80, status: "verified",
      note: `${n} fighter/event link${n === 1 ? "" : "s"}`,
    })),
    ...[...venues.entries()].map(([name, v]): RegistryOrg => ({
      id: `venue-${name}`, name, type: "venue", sports: [], jurisdiction: v.place, confidence: 80, status: "verified",
      note: `${v.count} event${v.count === 1 ? "" : "s"} hosted`,
    })),
  ];

  // Ingested national member federations (empty until the ingest script runs).
  const nationals: RegistryOrg[] = NATIONAL_FEDERATIONS.map((n) => ({
    id: n.id, name: n.name, type: "federation", sports: [n.sport],
    jurisdiction: n.country, sourceUrl: n.countryUrl ?? n.sourceUrl,
    confidence: 100, status: "official",
    note: `National member federation · ${n.body.toUpperCase()}`,
  }));

  const all = [...REGISTRY_SEED, ...nationals, ...derived];
  const counts = TABS.reduce<Record<string, number>>((acc, t) => {
    acc[t.key] = t.key === "all" ? all.length : all.filter((o) => o.type === t.key).length;
    return acc;
  }, {});

  const PER_PAGE = 12;
  const sorted = (active === "all" ? all : all.filter((o) => o.type === active))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  const shown = sorted.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <>
      <PageHero
        eyebrow="The ecosystem"
        title="Combat Registry"
        description="Federations, commissions, sanctioning bodies, promoters, gyms and venues across every combat sport — one source-backed network. Claim a profile, submit a correction or add what's missing."
      >
        <div className="flex flex-wrap gap-2">
          <Badge tone="gold"><ShieldCheck className="size-3" /> Source-backed</Badge>
          <Badge tone="neutral">{all.length} entities mapped</Badge>
          <Badge tone="neutral">9 sports</Badge>
        </div>
      </PageHero>

      <div className="container-cr py-10">
        {/* Type filter */}
        <div className="mb-8 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const on = t.key === active;
            const href = t.key === "all" ? "/registry" : `/registry?type=${t.key}`;
            return (
              <Link
                key={t.key}
                href={href}
                className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors ${
                  on ? "border-blood-500/50 bg-blood-500/15 text-blood-200" : "border-ink-700 bg-ink-850/60 text-mist hover:border-ink-600 hover:text-chalk"
                }`}
              >
                <t.icon className="size-4" /> {t.label}
                <span className="rounded bg-ink-800 px-1.5 text-[0.65rem] text-fog">{counts[t.key]}</span>
              </Link>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-fog">No entries in this category yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((o) => {
              const Icon = ICON[o.type];
              return (
                <div key={o.id} className="card-surface flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-mist">
                      <Icon className="size-5" />
                    </div>
                    <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                  </div>
                  <div>
                    <p className="font-display text-sm font-bold leading-tight text-chalk">{o.name}</p>
                    <p className="mt-0.5 text-xs text-fog">
                      {ORG_TYPE_LABEL[o.type]}{o.jurisdiction ? ` · ${o.jurisdiction}` : ""}
                    </p>
                  </div>
                  {o.sports.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {o.sports.map((s) => (
                        <span key={s} className="rounded bg-ink-800 px-2 py-0.5 text-[0.65rem] text-mist">{s}</span>
                      ))}
                    </div>
                  )}
                  {o.note && <p className="text-xs leading-relaxed text-mist">{o.note}</p>}
                  <div className="mt-auto flex items-center justify-between border-t border-ink-800 pt-3">
                    <span className="text-[0.65rem] uppercase tracking-wider text-fog">Confidence {o.confidence}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Pager page={page} hasNext={(page + 1) * PER_PAGE < sorted.length} />

        <div className="mt-10 rounded-card border border-ink-700 bg-ink-850/40 p-6">
          <h2 className="font-display text-base font-bold uppercase tracking-wide text-chalk">Missing or incorrect?</h2>
          <p className="mt-2 max-w-2xl text-sm text-mist">
            The registry grows from events, official directories and member submissions — every claim carries a source,
            confidence score and last-checked date. Add a gym, coach, promoter or official, claim your profile, or report
            a correction.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/account" className="rounded-lg bg-blood-500 px-4 py-2 font-display text-xs font-semibold uppercase text-white transition-colors hover:bg-blood-400">
              Claim a profile
            </Link>
            <Link href="/account" className="rounded-lg border border-ink-700 px-4 py-2 font-display text-xs font-semibold uppercase text-mist transition-colors hover:border-ink-600 hover:text-chalk">
              Submit an entry
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
