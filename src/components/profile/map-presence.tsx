"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MapPin, EyeOff, Globe2, Users, Dumbbell, CalendarDays, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  "Am I on the map?" — the user-facing half of the privacy gate.
//
//  Two things this panel does deliberately:
//
//   · It never asks for GPS. It asks for a CITY, and says out loud that a city
//     is all that is stored. The browser's location is used elsewhere on the
//     map for distance sorting, in memory, and is never sent here.
//   · It states the CURRENT state in a sentence before offering to change it,
//     because "who can see me" is exactly the setting people misremember.
// ════════════════════════════════════════════════════════════════════════════

type Visibility = "HIDDEN" | "PUBLIC" | "FOLLOWERS" | "GYM_MEMBERS" | "EVENTS_ONLY";

const OPTIONS: { id: Visibility; label: string; help: string; icon: typeof Globe2 }[] = [
  { id: "HIDDEN", label: "Hidden", help: "Nobody sees you on the map.", icon: EyeOff },
  { id: "PUBLIC", label: "Everyone", help: "Anyone browsing the map can see your city.", icon: Globe2 },
  { id: "FOLLOWERS", label: "Friends", help: "Only people you follow who follow you back.", icon: Users },
  { id: "GYM_MEMBERS", label: "Gym mates", help: "Only people who train at a gym you're a member of.", icon: Dumbbell },
  { id: "EVENTS_ONLY", label: "At events", help: "Only while you're checked in to an event.", icon: CalendarDays },
];

interface Settings {
  mapVisibility: Visibility;
  mapCity: string | null;
  mapCountryCode: string | null;
  mapLat: number | null;
  mapLon: number | null;
  openToSpar: boolean;
  lookingForTraining: boolean;
}

export function MapPresencePanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/me/map")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d?.settings) return;
        setSettings(d.settings);
        setCity(d.settings.mapCity ?? "");
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function save(next: Partial<Settings> & { mapVisibility: Visibility }) {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/me/map", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mapVisibility: next.mapVisibility,
          mapCity: city.trim() || null,
          mapCountry: country.trim() || null,
          openToSpar: next.openToSpar ?? settings?.openToSpar,
          lookingForTraining: next.lookingForTraining ?? settings?.lookingForTraining,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "Could not save."); return; }
      setSettings(d.settings);
      setWarning(d.warning ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-5 text-sm text-fog">
        <Loader2 className="size-4 animate-spin" /> Loading map settings…
      </div>
    );
  }

  const on = settings.mapVisibility !== "HIDDEN";
  const plotted = on && settings.mapLat !== null;
  const current = OPTIONS.find((o) => o.id === settings.mapVisibility)!;

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
      <div className="flex items-start gap-3 border-b border-ink-800 px-4 py-3.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            plotted ? "bg-gold-500/15 text-gold-300" : "bg-ink-800 text-fog",
          )}
        >
          <MapPin className="size-[1.05rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold uppercase tracking-wide text-chalk">On the map</p>
          <p className="mt-0.5 text-[0.76rem] leading-relaxed text-fog">
            {plotted
              ? `You appear in ${settings.mapCity}. ${current.help}`
              : on
                ? "You're set to visible but we don't have a city for you yet."
                : "You're hidden. Nobody can see you on the map."}
          </p>
        </div>
        {saved && <Check className="mt-1 size-4 shrink-0 text-up" />}
      </div>

      <div className="px-4 py-3.5">
        <p className="mb-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist">Who can see me</p>
        <div className="flex flex-col gap-1.5">
          {OPTIONS.map(({ id, label, help, icon: Icon }) => {
            const active = settings.mapVisibility === id;
            return (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => save({ mapVisibility: id })}
                aria-pressed={active}
                className={cn(
                  "tap flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                  active
                    ? "border-blood-500/50 bg-blood-500/10"
                    : "border-ink-700 bg-ink-850 hover:border-ink-600",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active ? "text-blood-300" : "text-fog")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.82rem] font-semibold text-chalk">{label}</span>
                  <span className="block text-[0.68rem] leading-relaxed text-fog">{help}</span>
                </span>
                {active && <Check className="size-4 shrink-0 text-blood-300" />}
              </button>
            );
          })}
        </div>

        <p className="mb-2 mt-4 font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist">Your city</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Bangkok"
            maxLength={80}
            className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none"
          />
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder={settings.mapCountryCode ?? "Thailand"}
            maxLength={80}
            className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none"
          />
        </div>
        <p className="mt-1.5 text-[0.68rem] leading-relaxed text-fog">
          We store the city, not your position. Your pin sits at the city centre — never at an address, and never
          from your device&apos;s GPS.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Toggle
            label="Open to spar"
            on={settings.openToSpar}
            disabled={busy}
            onClick={() => save({ mapVisibility: settings.mapVisibility, openToSpar: !settings.openToSpar })}
          />
          <Toggle
            label="Looking for training"
            on={settings.lookingForTraining}
            disabled={busy}
            onClick={() =>
              save({ mapVisibility: settings.mapVisibility, lookingForTraining: !settings.lookingForTraining })
            }
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => save({ mapVisibility: settings.mapVisibility })}
          className="tap mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blood-500 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-blood-400 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Save city
        </button>

        {warning && <p className="mt-2 text-[0.7rem] leading-relaxed text-gold-300">{warning}</p>}
        {error && <p className="mt-2 text-[0.7rem] text-down">{error}</p>}

        {plotted && (
          <Link
            href="/map"
            className="mt-2.5 block text-center text-[0.72rem] font-semibold text-blood-300 underline-offset-2 hover:underline"
          >
            See yourself on the map
          </Link>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label, on, disabled, onClick,
}: { label: string; on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "tap rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold transition-colors disabled:opacity-60",
        on
          ? "border-gold-500/50 bg-gold-500/15 text-gold-300"
          : "border-ink-700 bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk",
      )}
    >
      {label}
    </button>
  );
}
