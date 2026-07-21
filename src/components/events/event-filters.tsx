"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { SPORTS } from "@/lib/sports";
import type { EventFacet } from "@/lib/events-query";
import { cn } from "@/lib/utils";

// Every filter lives in the URL and nothing is filtered on the client — this
// component only WRITES query params; the server does the work and re-renders.
// That makes each combination shareable, bookmarkable and indexable.

const FILTER_SPORTS = SPORTS.filter((s) => !["BJJ_NOGI", "COMBAT_SAMBO"].includes(s.value));

const STATUSES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Results" },
  { value: "cancelled", label: "Off" },
];

const WINDOWS = [
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
  { value: "quarter", label: "90 days" },
];

export function EventFilters({ facets }: { facets: { promotions: EventFacet[]; countries: EventFacet[] } }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const get = (k: string) => params.get(k) ?? "";
  const active = ["sport", "promotion", "status", "country", "when"].filter((k) => {
    const v = get(k);
    return v && !(k === "status" && v === "upcoming");
  });

  function set(key: string, value: string) {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("page"); // any filter change invalidates the current page
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function clearAll() {
    router.push(pathname, { scroll: false });
  }

  return (
    <div className="space-y-3">
      <Row label="Sport">
        <Pill onClick={() => set("sport", "")} active={!get("sport")}>All</Pill>
        {FILTER_SPORTS.map((s) => (
          <Pill key={s.slug} onClick={() => set("sport", s.slug)} active={get("sport") === s.slug}>{s.label}</Pill>
        ))}
      </Row>

      <Row label="When">
        {STATUSES.map((s) => (
          <Pill
            key={s.value}
            onClick={() => set("status", s.value === "upcoming" ? "" : s.value)}
            active={(get("status") || "upcoming") === s.value}
          >
            {s.label}
          </Pill>
        ))}
        <span className="mx-1 w-px shrink-0 self-stretch bg-ink-700" aria-hidden />
        {WINDOWS.map((w) => (
          <Pill key={w.value} onClick={() => set("when", get("when") === w.value ? "" : w.value)} active={get("when") === w.value}>
            {w.label}
          </Pill>
        ))}
      </Row>

      {facets.promotions.length > 0 && (
        <Row label="Promotion">
          <Pill onClick={() => set("promotion", "")} active={!get("promotion")}>All</Pill>
          {facets.promotions.map((p) => (
            <Pill key={p.value} onClick={() => set("promotion", p.value)} active={get("promotion") === p.value}>
              {p.label} <Count n={p.count} />
            </Pill>
          ))}
        </Row>
      )}

      {facets.countries.length > 0 && (
        <Row label="Location">
          <Pill onClick={() => set("country", "")} active={!get("country")}>Anywhere</Pill>
          {facets.countries.map((c) => (
            <Pill key={c.value} onClick={() => set("country", c.value)} active={get("country") === c.value}>
              {c.label} <Count n={c.count} />
            </Pill>
          ))}
        </Row>
      )}

      {active.length > 0 && (
        <button
          onClick={clearAll}
          className="inline-flex items-center gap-1 rounded-full border border-ink-700 px-3 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300"
        >
          <X className="size-3.5" /> Clear {active.length} filter{active.length === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[4.5rem] shrink-0 text-[0.65rem] font-bold uppercase tracking-wider text-fog">{label}</span>
      <div data-hscroll className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

function Pill({ onClick, active, children }: { onClick: () => void; active: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
        active
          ? "border-blood-500 bg-blood-500 text-white"
          : "border-ink-700 bg-ink-900/60 text-mist hover:border-blood-500/50 hover:text-chalk",
      )}
    >
      {children}
    </button>
  );
}

const Count = ({ n }: { n: number }) => <span className="ml-0.5 tabular-nums opacity-60">{n}</span>;
