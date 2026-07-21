"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { PromotionLogo } from "@/components/promotion-logo";
import { Flag } from "@/components/flag";
import { SPORTS } from "@/lib/sports";
import { cn } from "@/lib/utils";

// The first run. Four questions, each one turning into a follow, ending on a
// Following feed that already has something in it. No wizard framework: it is a
// step index and a state object, because that is all four screens need.

const ROLES = [
  { value: "fan", label: "Fan", blurb: "I watch and predict" },
  { value: "fighter", label: "Fighter", blurb: "I compete" },
  { value: "coach", label: "Coach", blurb: "I corner and train" },
  { value: "media", label: "Media", blurb: "I cover the sport" },
];
const SPORT_MIN = 2;
const SPORT_MAX = 5;

interface PromotionOption { slug: string; name: string; upcoming: number }
interface FighterOption { id: string; slug: string; name: string; sport: string; countryCode: string | null; record: string; image: string | null }

export function OnboardingFlow({ initial }: {
  initial: { role: string; sports: string[]; promotions: string[]; fighters: string[] };
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState(initial.role);
  const [sports, setSports] = useState<string[]>(initial.sports);
  const [promotions, setPromotions] = useState<string[]>(initial.promotions);
  const [fighters, setFighters] = useState<string[]>(initial.fighters);
  const [options, setOptions] = useState<{ promotions: PromotionOption[]; fighters: FighterOption[] }>({ promotions: [], fighters: [] });
  const [busy, setBusy] = useState(false);

  // Options depend on the chosen sports, so they are fetched once the user
  // reaches the promotion step — never on mount, when we'd suggest everything.
  useEffect(() => {
    if (step < 2) return;
    let live = true;
    fetch(`/api/onboarding?sports=${encodeURIComponent(sports.join(","))}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (live) setOptions(d); })
      .catch(() => { /* the step still works, just without suggestions */ });
    return () => { live = false; };
  }, [step, sports]);

  const persist = useCallback(async (patch: Record<string, unknown>) => {
    await fetch("/api/onboarding", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
    }).catch(() => { /* a dropped step is re-sent by the next one */ });
  }, []);

  async function finish() {
    setBusy(true);
    await persist({ role, sports, promotions, fighters });
    await fetch("/api/onboarding", { method: "POST" }).catch(() => {});
    router.push("/following");
    router.refresh();
  }

  async function next() {
    setBusy(true);
    // Persist THIS step before advancing, so abandoning mid-flow loses nothing.
    await persist(step === 0 ? { role } : step === 1 ? { sports } : step === 2 ? { promotions } : { fighters });
    setBusy(false);
    if (step === 3) return finish();
    setStep((s) => s + 1);
  }

  const toggle = (list: string[], set: (v: string[]) => void, value: string, max?: number) => {
    if (list.includes(value)) set(list.filter((v) => v !== value));
    else if (!max || list.length < max) set([...list, value]);
  };

  const canAdvance = step === 0 ? !!role : step === 1 ? sports.length >= SPORT_MIN : true;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col px-4 py-6">
      {/* Progress. Four dots, not a percentage — it reads as "nearly done". */}
      <div className="mb-6 flex items-center gap-2" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={4}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-blood-500" : "bg-ink-800")} />
        ))}
      </div>

      <div className="flex-1">
        {step === 0 && (
          <Step title="Welcome to Combat Reviews" sub="Two questions and you're in. What brings you here?">
            <div className="grid gap-2.5">
              {ROLES.map((r) => (
                <Choice key={r.value} selected={role === r.value} onClick={() => setRole(r.value)}>
                  <span className="font-display text-sm font-bold text-chalk">{r.label}</span>
                  <span className="text-xs text-fog">{r.blurb}</span>
                </Choice>
              ))}
            </div>
          </Step>
        )}

        {step === 1 && (
          <Step title="Which sports?" sub={`Pick ${SPORT_MIN}–${SPORT_MAX}. This decides what fills your feed.`}>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((s) => {
                const on = sports.includes(s.value);
                const full = sports.length >= SPORT_MAX && !on;
                return (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={on}
                    disabled={full}
                    onClick={() => toggle(sports, setSports, s.value, SPORT_MAX)}
                    className={cn(
                      "tap rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors",
                      on ? "border-blood-500 bg-blood-500/15 text-chalk" : "border-ink-700 text-mist hover:border-ink-600",
                      full && "cursor-not-allowed opacity-40",
                    )}
                  >
                    {on && <Check className="mr-1 inline size-3.5" />}{s.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-fog">{sports.length} of {SPORT_MAX} chosen</p>
          </Step>
        )}

        {step === 2 && (
          <Step title="Any promotions?" sub="We'll follow their next cards for you. Skip if you're not sure.">
            {options.promotions.length === 0 ? (
              <Skeleton />
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {options.promotions.map((p) => (
                  <Choice key={p.slug} selected={promotions.includes(p.slug)} onClick={() => toggle(promotions, setPromotions, p.slug)} row>
                    <PromotionLogo promotion={p.slug} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-display text-sm font-bold text-chalk">{p.name}</span>
                      <span className="text-[0.7rem] text-fog">{p.upcoming} upcoming</span>
                    </span>
                  </Choice>
                ))}
              </div>
            )}
          </Step>
        )}

        {step === 3 && (
          <Step title="Any fighters?" sub="You'll know the moment they're booked.">
            {options.fighters.length === 0 ? (
              <Skeleton />
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {options.fighters.map((f) => (
                  <Choice key={f.id} selected={fighters.includes(f.id)} onClick={() => toggle(fighters, setFighters, f.id)} row>
                    {f.image ? (
                      <Image src={f.image} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full object-cover" unoptimized />
                    ) : (
                      <span className="size-8 shrink-0 rounded-full bg-ink-800" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-display text-sm font-bold text-chalk">{f.name}</span>
                      <span className="flex items-center gap-1 text-[0.7rem] tabular-nums text-fog">
                        <Flag code={f.countryCode} /> {f.record}
                      </span>
                    </span>
                  </Choice>
                ))}
              </div>
            )}
          </Step>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={finish}
          disabled={busy}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-fog transition-colors hover:text-mist disabled:opacity-50"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={next}
          disabled={busy || !canAdvance}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blood-500 px-5 py-2.5 font-display text-sm font-semibold text-white transition-colors hover:bg-blood-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {step === 3 ? "Finish" : "Continue"}
          {!busy && <ArrowRight className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function Step({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-black leading-tight text-chalk">{title}</h1>
      <p className="mb-5 mt-1.5 text-sm text-fog">{sub}</p>
      {children}
    </div>
  );
}

function Choice({ selected, onClick, children, row }: {
  selected: boolean; onClick: () => void; children: React.ReactNode; row?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "tap rounded-xl border p-3 text-left transition-colors",
        row ? "flex items-center gap-2.5" : "flex flex-col gap-0.5",
        selected ? "border-blood-500 bg-blood-500/10" : "border-ink-700 hover:border-ink-600 hover:bg-ink-900",
      )}
    >
      {children}
      {selected && !row && <Check className="absolute right-3 top-3 size-4 text-blood-400" />}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-ink-900" />)}
    </div>
  );
}
