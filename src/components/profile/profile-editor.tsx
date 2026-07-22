"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Loader2, Check, Globe, Instagram, Youtube, Facebook, AtSign, Music2,
  Dumbbell, MapPin, EyeOff, Users, CalendarDays, Globe2, ChevronRight, Pencil,
} from "lucide-react";
import { REGISTRY_ROLE_DEFS, ROLE_GROUPS, rolesInGroup } from "@/lib/roles";
import { SPORTS } from "@/lib/sports";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  The profile control centre.
//
//  Every editable field in one place, saving through one PATCH. Two rules make
//  it feel instant without lying:
//
//   · Toggles (role, discipline, visibility) save OPTIMISTICALLY and roll back
//     on failure — they are single values, so a failed save has one obvious
//     thing to undo.
//   · Text fields save on BLUR, not per keystroke. A debounce-per-keystroke
//     would put a request behind every letter of a bio.
//
//  Map presence lives here rather than on its own screen: "who can see me" is
//  a fact about a person, and it belongs next to the rest of them.
// ════════════════════════════════════════════════════════════════════════════

type Visibility = "HIDDEN" | "PUBLIC" | "FOLLOWERS" | "GYM_MEMBERS" | "EVENTS_ONLY";

interface Profile {
  name: string | null;
  username: string | null;
  bio: string | null;
  registryRole: string;
  sportPrefs: string[];
  website: string | null;
  instagram: string | null;
  twitter: string | null;
  youtube: string | null;
  tiktok: string | null;
  facebook: string | null;
  weightClassPref: string | null;
  yearsTraining: number | null;
  mapVisibility: Visibility;
  mapCity: string | null;
  mapCountryCode: string | null;
  mapLat: number | null;
  openToSpar: boolean;
  lookingForTraining: boolean;
}

interface HomeGym { slug: string; name: string; city: string | null; verified: boolean }

const VISIBILITY: { id: Visibility; label: string; help: string; icon: typeof Globe2 }[] = [
  { id: "HIDDEN", label: "Hidden", help: "Nobody sees you on the map. This is the default.", icon: EyeOff },
  { id: "PUBLIC", label: "Everyone", help: "Anyone browsing the map can see your city.", icon: Globe2 },
  { id: "FOLLOWERS", label: "Friends", help: "Only people you follow who follow you back.", icon: Users },
  { id: "GYM_MEMBERS", label: "Gym mates", help: "Only people who train at a gym you belong to.", icon: Dumbbell },
  { id: "EVENTS_ONLY", label: "At events", help: "Only while you're checked in to an event.", icon: CalendarDays },
];

const SOCIALS = [
  { key: "instagram", label: "Instagram", icon: Instagram, prefix: "@" },
  { key: "twitter", label: "X", icon: AtSign, prefix: "@" },
  { key: "youtube", label: "YouTube", icon: Youtube, prefix: "" },
  { key: "tiktok", label: "TikTok", icon: Music2, prefix: "@" },
  { key: "facebook", label: "Facebook", icon: Facebook, prefix: "" },
] as const;

export function ProfileEditor() {
  const [p, setP] = useState<Profile | null>(null);
  const [homeGym, setHomeGym] = useState<HomeGym | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    let live = true;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d?.profile) return;
        setP(d.profile);
        setHomeGym(d.homeGym ?? null);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  /** Optimistic PATCH: apply locally, then reconcile or roll back. */
  const save = useCallback(
    async (patch: Partial<Profile> & { mapCountry?: string }, optimistic = true) => {
      if (!p) return;
      const before = p;
      const id = ++seq.current;
      if (optimistic) setP({ ...p, ...patch } as Profile);
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? "Could not save.");
        // Ignore a stale response — a later edit has already won.
        if (id !== seq.current) return;
        setP(d.profile);
        setWarning(d.warning ?? null);
        setSavedAt(Date.now());
      } catch (e) {
        if (id === seq.current) {
          setP(before);
          setError(e instanceof Error ? e.message : "Could not save.");
        }
      } finally {
        if (id === seq.current) setSaving(false);
      }
    },
    [p],
  );

  if (!p) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-6 text-sm text-fog">
        <Loader2 className="size-4 animate-spin" /> Loading your profile…
      </div>
    );
  }

  const justSaved = Date.now() - savedAt < 2500;
  const onMap = p.mapVisibility !== "HIDDEN" && p.mapLat !== null;

  return (
    <div className="flex flex-col gap-4">
      <StatusBar saving={saving} saved={justSaved} error={error} />

      {/* ── Who you are ── */}
      <Card title="Who you are">
        <Field label="Display name">
          <TextInput
            defaultValue={p.name ?? ""}
            placeholder="Your name"
            maxLength={60}
            onCommit={(v) => v !== (p.name ?? "") && save({ name: v || null }, false)}
          />
        </Field>

        <Field label="Bio" hint={`${(p.bio ?? "").length}/400`}>
          <textarea
            defaultValue={p.bio ?? ""}
            maxLength={400}
            rows={3}
            placeholder="Where you train, what you compete in, what you're chasing."
            onBlur={(e) => e.target.value !== (p.bio ?? "") && save({ bio: e.target.value || null }, false)}
            className={inputClass}
          />
        </Field>

        {p.username && (
          <p className="text-[0.7rem] text-fog">
            Your profile is at{" "}
            <Link href={`/u/${p.username}`} className="font-semibold text-blood-300 underline-offset-2 hover:underline">
              /u/{p.username}
            </Link>
            . Usernames are permanent.
          </p>
        )}
      </Card>

      {/* ── Role ── */}
      <Card title="Your role" subtitle="What you do in combat sports. Changes take effect immediately.">
        <div className="flex flex-col gap-3">
          {ROLE_GROUPS.map((g) => (
            <div key={g.id}>
              <span className="mb-1.5 block font-display text-[0.6rem] font-bold uppercase tracking-[0.16em] text-fog">
                {g.label}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {rolesInGroup(g.id).map((r) => (
                  <Chip
                    key={r.value}
                    size="sm"
                    active={p.registryRole === r.value}
                    onClick={() => save({ registryRole: r.value })}
                  >
                    {r.label}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
        {REGISTRY_ROLE_DEFS.find((r) => r.value === p.registryRole)?.claimable && (
          <p className="mt-1 rounded-xl border border-gold-500/30 bg-gold-500/10 px-3 py-2.5 text-[0.72rem] leading-relaxed text-gold-300">
            This role can be verified. Claim your fighter page or your gym to get the verified badge — a role on its
            own is a self-declaration, not a verification.
          </p>
        )}
      </Card>

      {/* ── Disciplines ── */}
      <Card title="Disciplines" subtitle="What you train or follow. Used to personalise your feed.">
        <div className="flex flex-wrap gap-1.5">
          {/* Displays the LABEL, stores the canonical VALUE — the column is
              shared with onboarding and read back as a Prisma sport filter. */}
          {SPORTS.map((sport) => {
            const on = p.sportPrefs.includes(sport.value);
            return (
              <Chip
                key={sport.value}
                size="sm"
                tone="neutral"
                active={on}
                onClick={() =>
                  save({
                    sportPrefs: on
                      ? p.sportPrefs.filter((x) => x !== sport.value)
                      : [...p.sportPrefs, sport.value].slice(0, 8),
                  })
                }
              >
                {sport.label}
              </Chip>
            );
          })}
        </div>
      </Card>

      {/* ── Fighter details ── */}
      {(p.registryRole === "fighter" || p.registryRole === "world_champion") && (
        <Card title="Fighter details" subtitle="Self-declared. Your verified record comes from claiming your fighter page.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Weight class">
              <TextInput
                defaultValue={p.weightClassPref ?? ""}
                placeholder="Lightweight"
                maxLength={40}
                onCommit={(v) => v !== (p.weightClassPref ?? "") && save({ weightClassPref: v || null }, false)}
              />
            </Field>
            <Field label="Years training">
              <TextInput
                defaultValue={p.yearsTraining?.toString() ?? ""}
                placeholder="8"
                inputMode="numeric"
                maxLength={2}
                onCommit={(v) => {
                  const n = v === "" ? null : Number(v);
                  if (n !== null && (!Number.isFinite(n) || n < 0 || n > 80)) return;
                  if (n !== p.yearsTraining) save({ yearsTraining: n }, false);
                }}
              />
            </Field>
          </div>
        </Card>
      )}

      {/* ── Home gym ── */}
      <Card title="Home gym">
        {homeGym ? (
          <Link
            href={`/gyms/${homeGym.slug}`}
            className="flex items-center gap-3 rounded-xl border border-volt-500/25 bg-volt-500/8 px-3.5 py-3 transition-colors hover:border-volt-500/40"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-volt-500/15 text-volt-400">
              <Dumbbell className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-bold text-chalk">{homeGym.name}</span>
              <span className="block truncate text-[0.7rem] text-fog">{homeGym.city ?? "Change from the gym page"}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fog" />
          </Link>
        ) : (
          <div className="rounded-xl border border-dashed border-ink-700 px-3.5 py-4 text-center">
            <p className="text-[0.78rem] text-fog">
              No home gym set. Find where you train and tap &ldquo;I train here&rdquo;.
            </p>
            <div className="mt-2.5 flex justify-center gap-2">
              <Link href="/gyms" className="tap rounded-lg bg-blood-500 px-3.5 py-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-white hover:bg-blood-400">
                Find your gym
              </Link>
              <Link href="/gyms/new" className="tap rounded-lg border border-ink-700 px-3.5 py-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist hover:text-chalk">
                Add it
              </Link>
            </div>
          </div>
        )}
      </Card>

      {/* ── Links ── */}
      <Card title="Links">
        <Field label="Website">
          <TextInput
            icon={<Globe className="size-4" />}
            defaultValue={p.website ?? ""}
            placeholder="yoursite.com"
            maxLength={200}
            onCommit={(v) => v !== (p.website ?? "") && save({ website: v || null }, false)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIALS.map(({ key, label, icon: Icon, prefix }) => (
            <Field key={key} label={label}>
              <TextInput
                icon={<Icon className="size-4" />}
                prefix={prefix}
                defaultValue={(p[key] as string | null) ?? ""}
                placeholder={prefix ? "handle" : "page or channel"}
                maxLength={80}
                onCommit={(v) =>
                  v !== ((p[key] as string | null) ?? "") && save({ [key]: v || null } as Partial<Profile>, false)
                }
              />
            </Field>
          ))}
        </div>
      </Card>

      {/* ── Map presence ── */}
      <Card
        title="On the map"
        subtitle={
          onMap
            ? `You appear in ${p.mapCity}. ${VISIBILITY.find((v) => v.id === p.mapVisibility)?.help}`
            : p.mapVisibility !== "HIDDEN"
              ? "You're set to visible but we don't have a city for you yet."
              : "You're hidden. Nobody can see you on the map."
        }
      >
        <div className="flex flex-col gap-1.5">
          {VISIBILITY.map(({ id, label, help, icon: Icon }) => {
            const active = p.mapVisibility === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => save({ mapVisibility: id })}
                aria-pressed={active}
                className={cn(
                  "tap flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  active ? "border-blood-500/50 bg-blood-500/10" : "border-ink-700 bg-ink-850 hover:border-ink-600",
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

        <div className="grid grid-cols-2 gap-2">
          <Field label="City">
            <TextInput
              icon={<MapPin className="size-4" />}
              defaultValue={p.mapCity ?? ""}
              placeholder="Bangkok"
              maxLength={80}
              onCommit={(v) => v !== (p.mapCity ?? "") && save({ mapCity: v || null, mapCountry: country }, false)}
            />
          </Field>
          <Field label="Country">
            <TextInput
              defaultValue={p.mapCountryCode ?? ""}
              placeholder="Thailand"
              maxLength={80}
              onCommit={(v) => { setCountry(v); if (v) save({ mapCity: p.mapCity, mapCountry: v }, false); }}
            />
          </Field>
        </div>

        <p className="text-[0.68rem] leading-relaxed text-fog">
          We store the city, not your position. Your pin sits at the city centre — never at an address, and never from
          your device&apos;s GPS.
        </p>

        <div className="flex flex-wrap gap-2">
          <Chip size="sm" tone="neutral" active={p.openToSpar} onClick={() => save({ openToSpar: !p.openToSpar })}>
            Open to spar
          </Chip>
          <Chip
            size="sm"
            tone="neutral"
            active={p.lookingForTraining}
            onClick={() => save({ lookingForTraining: !p.lookingForTraining })}
          >
            Looking for training
          </Chip>
        </div>

        {warning && <p className="text-[0.7rem] leading-relaxed text-gold-300">{warning}</p>}
        {onMap && (
          <Link href="/map" className="text-center text-[0.72rem] font-semibold text-blood-300 underline-offset-2 hover:underline">
            See yourself on the map
          </Link>
        )}
      </Card>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none";

function Card({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{title}</h3>
      {subtitle && <p className="mt-1 text-[0.72rem] leading-relaxed text-fog">{subtitle}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="font-display text-[0.68rem] font-bold uppercase tracking-wide text-mist">{label}</span>
        {hint && <span className="text-[0.62rem] text-fog">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Uncontrolled input that commits on blur or Enter — one request per edit,
 *  not one per keystroke. */
function TextInput({
  defaultValue, placeholder, maxLength, icon, prefix, inputMode, onCommit,
}: {
  defaultValue: string;
  placeholder?: string;
  maxLength?: number;
  icon?: React.ReactNode;
  prefix?: string;
  inputMode?: "numeric";
  onCommit: (value: string) => void;
}) {
  return (
    <span className="relative flex items-center">
      {icon && <span className="pointer-events-none absolute left-3 text-fog">{icon}</span>}
      {prefix && (
        <span className={cn("pointer-events-none absolute text-sm text-fog", icon ? "left-9" : "left-3")}>{prefix}</span>
      )}
      <input
        type="text"
        inputMode={inputMode}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={maxLength}
        onBlur={(e) => onCommit(e.target.value.trim())}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={cn(inputClass, icon && "pl-9", prefix && (icon ? "pl-[3.25rem]" : "pl-7"))}
      />
    </span>
  );
}

/** Sticky save indicator — the only feedback an auto-saving form gets. */
function StatusBar({
  saving, saved, error,
}: { saving: boolean; saved: boolean; error: string | null }) {
  if (error) {
    return (
      <p className="sticky top-0 z-10 rounded-xl border border-down/40 bg-down/15 px-3.5 py-2.5 text-[0.76rem] font-semibold text-down backdrop-blur">
        {error}
      </p>
    );
  }
  if (!saving && !saved) return null;
  return (
    <p className="sticky top-0 z-10 inline-flex items-center gap-1.5 self-start rounded-full border border-ink-700 bg-ink-950/90 px-3 py-1.5 text-[0.7rem] font-semibold text-mist backdrop-blur">
      {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-up" />}
      {saving ? "Saving…" : "Saved"}
    </p>
  );
}

/** Small entry point used by the profile header. */
export function EditProfileLink() {
  return (
    <Link
      href="/profile/edit"
      className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 font-display text-[0.68rem] font-bold uppercase tracking-wide text-chalk hover:border-ink-500"
    >
      <Pencil className="size-3" /> Edit profile
    </Link>
  );
}
