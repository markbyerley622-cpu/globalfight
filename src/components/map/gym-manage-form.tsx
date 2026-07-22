"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Check, Globe, Instagram, Phone, Mail, Clock, MapPin, Youtube, Facebook, Music2 } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { ImageUpload } from "@/components/ui/image-upload";
import { cn } from "@/lib/utils";

const DISCIPLINE_OPTIONS = [
  "MMA", "Muay Thai", "Boxing", "BJJ", "Kickboxing", "Wrestling",
  "Judo", "Sambo", "Karate", "Taekwondo", "Strength", "Bare Knuckle",
];

export interface ManagedGym {
  slug: string;
  name: string;
  description: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  instagram: string | null;
  phone: string | null;
  email: string | null;
  hoursNote: string | null;
  disciplines: string[];
  verified: boolean;
  memberCount: number;
  logoUrl: string | null;
  heroUrl: string | null;
  facebook: string | null;
  youtube: string | null;
  tiktok: string | null;
}

const inputClass =
  "w-full rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none";

/** Same save model as the profile editor: toggles are optimistic, text commits
 *  on blur. Deliberately the same, so managing a gym feels like editing a
 *  profile rather than a different application. */
export function GymManageForm({ gym }: { gym: ManagedGym }) {
  const [g, setG] = useState(gym);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const save = useCallback(
    async (patch: Partial<ManagedGym>, optimistic = true) => {
      const before = g;
      const id = ++seq.current;
      if (optimistic) setG({ ...g, ...patch });
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/gyms/${encodeURIComponent(gym.slug)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? "Could not save.");
        if (id !== seq.current) return;
        setG((cur) => ({ ...cur, ...d.gym }));
        setSavedAt(Date.now());
      } catch (e) {
        if (id === seq.current) {
          setG(before);
          setError(e instanceof Error ? e.message : "Could not save.");
        }
      } finally {
        if (id === seq.current) setSaving(false);
      }
    },
    [g, gym.slug],
  );

  const justSaved = Date.now() - savedAt < 2500;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="sticky top-0 z-10 rounded-xl border border-down/40 bg-down/15 px-3.5 py-2.5 text-[0.76rem] font-semibold text-down backdrop-blur">
          {error}
        </p>
      ) : (saving || justSaved) ? (
        <p className="sticky top-0 z-10 inline-flex items-center gap-1.5 self-start rounded-full border border-ink-700 bg-ink-950/90 px-3 py-1.5 text-[0.7rem] font-semibold text-mist backdrop-blur">
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-up" />}
          {saving ? "Saving…" : "Saved"}
        </p>
      ) : null}

      <Card title="The basics">
        <Field label="Gym name">
          <Text defaultValue={g.name} maxLength={80} onCommit={(v) => v && v !== g.name && save({ name: v }, false)} />
        </Field>
        <Field label="About" hint={`${(g.description ?? "").length}/600`}>
          <textarea
            defaultValue={g.description ?? ""}
            maxLength={600}
            rows={4}
            placeholder="What's it like to train here? Who's it for?"
            onBlur={(e) => e.target.value !== (g.description ?? "") && save({ description: e.target.value || null }, false)}
            className={inputClass}
          />
        </Field>
      </Card>

      <Card title="Disciplines" subtitle="What you actually teach. Drives the map's discipline filter.">
        <div className="flex flex-wrap gap-1.5">
          {DISCIPLINE_OPTIONS.map((d) => {
            const on = g.disciplines.includes(d);
            return (
              <Chip
                key={d}
                size="sm"
                tone="neutral"
                active={on}
                onClick={() =>
                  save({ disciplines: on ? g.disciplines.filter((x) => x !== d) : [...g.disciplines, d] })
                }
              >
                {d}
              </Chip>
            );
          })}
        </div>
      </Card>

      <Card title="Where you are" subtitle="Changing the city moves the gym's pin on the map.">
        <Field label="Street address">
          <Text
            icon={<MapPin className="size-4" />}
            defaultValue={g.address ?? ""}
            maxLength={160}
            placeholder="7/6 Moo 5, Soi Ta-iad"
            onCommit={(v) => v !== (g.address ?? "") && save({ address: v || null }, false)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <Text defaultValue={g.city ?? ""} maxLength={80} onCommit={(v) => v !== (g.city ?? "") && save({ city: v || null }, false)} />
          </Field>
          <Field label="Country">
            <Text defaultValue={g.country ?? ""} maxLength={80} onCommit={(v) => v !== (g.country ?? "") && save({ country: v || null }, false)} />
          </Field>
        </div>
        <Field label="Opening hours" hint="Free text">
          <Text
            icon={<Clock className="size-4" />}
            defaultValue={g.hoursNote ?? ""}
            maxLength={160}
            placeholder="Mon–Fri 6am–9pm · Open mat Sat 11am"
            onCommit={(v) => v !== (g.hoursNote ?? "") && save({ hoursNote: v || null }, false)}
          />
        </Field>
      </Card>

      <Card title="Contact">
        <Field label="Website">
          <Text
            icon={<Globe className="size-4" />}
            defaultValue={g.website ?? ""}
            maxLength={200}
            placeholder="yourgym.com"
            onCommit={(v) => v !== (g.website ?? "") && save({ website: v || null }, false)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Instagram">
            <Text
              icon={<Instagram className="size-4" />}
              defaultValue={g.instagram ?? ""}
              maxLength={80}
              placeholder="@yourgym"
              onCommit={(v) => v !== (g.instagram ?? "") && save({ instagram: v || null }, false)}
            />
          </Field>
          <Field label="Phone">
            <Text
              icon={<Phone className="size-4" />}
              defaultValue={g.phone ?? ""}
              maxLength={40}
              onCommit={(v) => v !== (g.phone ?? "") && save({ phone: v || null }, false)}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Facebook">
            <Text
              icon={<Facebook className="size-4" />}
              defaultValue={g.facebook ?? ""}
              maxLength={80}
              onCommit={(v) => v !== (g.facebook ?? "") && save({ facebook: v || null }, false)}
            />
          </Field>
          <Field label="YouTube">
            <Text
              icon={<Youtube className="size-4" />}
              defaultValue={g.youtube ?? ""}
              maxLength={80}
              onCommit={(v) => v !== (g.youtube ?? "") && save({ youtube: v || null }, false)}
            />
          </Field>
          <Field label="TikTok">
            <Text
              icon={<Music2 className="size-4" />}
              defaultValue={g.tiktok ?? ""}
              maxLength={80}
              onCommit={(v) => v !== (g.tiktok ?? "") && save({ tiktok: v || null }, false)}
            />
          </Field>
          <Field label="Email">
            <Text
              icon={<Mail className="size-4" />}
              defaultValue={g.email ?? ""}
              maxLength={120}
              onCommit={(v) => v !== (g.email ?? "") && save({ email: v || null }, false)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Logo &amp; hero" subtitle="The logo is your mark on cards and the map. The hero is the banner at the top of your page.">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <ImageUpload
            label="Logo"
            hint="Square"
            aspect="square"
            value={g.logoUrl}
            endpoint={`/api/gyms/${encodeURIComponent(gym.slug)}/image`}
            extraFields={{ kind: "logo" }}
            deleteEndpoint={`/api/gyms/${encodeURIComponent(gym.slug)}/image?kind=logo`}
            onUploaded={(url) => setG((c) => ({ ...c, logoUrl: url }))}
            onRemoved={() => setG((c) => ({ ...c, logoUrl: null }))}
          />
          <ImageUpload
            className="min-w-0 flex-1"
            label="Hero image"
            hint="Wide · 16:7"
            value={g.heroUrl}
            endpoint={`/api/gyms/${encodeURIComponent(gym.slug)}/image`}
            extraFields={{ kind: "hero" }}
            deleteEndpoint={`/api/gyms/${encodeURIComponent(gym.slug)}/image?kind=hero`}
            onUploaded={(url) => setG((c) => ({ ...c, heroUrl: url }))}
            onRemoved={() => setG((c) => ({ ...c, heroUrl: null }))}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-3">
        <span className="text-[0.74rem] text-fog">
          {g.memberCount} member{g.memberCount === 1 ? "" : "s"} · {g.verified ? "Verified" : "Unverified"}
        </span>
        <Link
          href={`/gyms/${g.slug}`}
          className="tap rounded-lg border border-ink-600 bg-ink-800 px-3.5 py-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-chalk hover:border-ink-500"
        >
          View public page
        </Link>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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

function Text({
  defaultValue, maxLength, placeholder, icon, onCommit,
}: {
  defaultValue: string;
  maxLength?: number;
  placeholder?: string;
  icon?: React.ReactNode;
  onCommit: (v: string) => void;
}) {
  return (
    <span className="relative flex items-center">
      {icon && <span className="pointer-events-none absolute left-3 text-fog">{icon}</span>}
      <input
        type="text"
        defaultValue={defaultValue}
        maxLength={maxLength}
        placeholder={placeholder}
        onBlur={(e) => onCommit(e.target.value.trim())}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={cn(inputClass, icon && "pl-9")}
      />
    </span>
  );
}
