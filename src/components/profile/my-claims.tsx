"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, BadgeCheck, Clock, XCircle, MessageSquare, Settings, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Gyms you own, and claims you've filed.
//
//  Ownership was previously a black hole: you could file a claim and then had
//  no way to see whether it was pending, approved or rejected — and if it WAS
//  approved, no route to the thing you now owned. This is that loop, closed
//  from the user's side.
// ════════════════════════════════════════════════════════════════════════════

interface Claim {
  id: string;
  status: string;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  gym: { slug: string; name: string; city: string | null };
}
interface Owned {
  slug: string; name: string; city: string | null; verified: boolean; memberCount: number;
}

const STATUS: Record<string, { label: string; help: string; tone: string; icon: typeof Clock }> = {
  pending: {
    label: "Under review",
    help: "A human checks every claim. We'll email you when it's decided.",
    tone: "bg-gold-500/15 text-gold-300",
    icon: Clock,
  },
  info_requested: {
    label: "More info needed",
    help: "We need something else before we can approve this.",
    tone: "bg-volt-500/15 text-volt-400",
    icon: MessageSquare,
  },
  approved: {
    label: "Approved",
    help: "You manage this gym's page.",
    tone: "bg-up/15 text-up",
    icon: BadgeCheck,
  },
  rejected: {
    label: "Not approved",
    help: "We couldn't confirm ownership from what was provided.",
    tone: "bg-down/15 text-down",
    icon: XCircle,
  },
};

export function MyClaims() {
  const [data, setData] = useState<{ claims: Claim[]; owned: Owned[] } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/me/claims")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setData({ claims: d.claims ?? [], owned: d.owned ?? [] }); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-5 text-sm text-fog">
        <Loader2 className="size-4 animate-spin" /> Loading gyms…
      </div>
    );
  }

  // Claims for a gym you now own are represented by the owned card instead —
  // showing both is the same fact twice.
  const ownedSlugs = new Set(data.owned.map((g) => g.slug));
  const claims = data.claims.filter((c) => !ownedSlugs.has(c.gym.slug));

  return (
    <section className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Your gyms</h3>
      <p className="mt-1 text-[0.72rem] leading-relaxed text-fog">
        Own a gym? Claim its page to manage photos, details and classes.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {/* Owned — the "Manage" experience replaces "Claim". */}
        {data.owned.map((g) => (
          <Link
            key={g.slug}
            href={`/gyms/${g.slug}/manage`}
            className="flex items-center gap-3 rounded-xl border border-up/30 bg-up/8 px-3.5 py-3 transition-colors hover:border-up/50"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-up/15 text-up">
              <Settings className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-display text-sm font-bold text-chalk">{g.name}</span>
                {g.verified && <BadgeCheck className="size-3.5 shrink-0 text-volt-400" />}
              </span>
              <span className="block truncate text-[0.7rem] text-fog">
                You manage this page · {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
              </span>
            </span>
            <span className="shrink-0 font-display text-[0.66rem] font-bold uppercase tracking-wide text-up">Manage</span>
          </Link>
        ))}

        {/* Claims in flight */}
        {claims.map((c) => {
          const s = STATUS[c.status] ?? STATUS.pending;
          const Icon = s.icon;
          return (
            <div key={c.id} className="rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <Link href={`/gyms/${c.gym.slug}`} className="min-w-0 flex-1 truncate font-display text-sm font-bold text-chalk hover:underline">
                  {c.gym.name}
                </Link>
                <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-display text-[0.6rem] font-bold uppercase tracking-wider", s.tone)}>
                  <Icon className="size-3" /> {s.label}
                </span>
              </div>
              <p className="mt-1 text-[0.7rem] leading-relaxed text-fog">{c.note || s.help}</p>
            </div>
          );
        })}

        {data.owned.length === 0 && claims.length === 0 && (
          <p className="rounded-xl border border-dashed border-ink-700 px-3.5 py-4 text-center text-[0.76rem] text-fog">
            You don&apos;t own or manage a gym yet.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Link href="/gyms" className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3.5 py-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist hover:text-chalk">
            <Search className="size-3.5" /> Find &amp; claim a gym
          </Link>
          <Link href="/gyms/new" className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3.5 py-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist hover:text-chalk">
            <Plus className="size-3.5" /> Add a gym
          </Link>
        </div>
      </div>
    </section>
  );
}
