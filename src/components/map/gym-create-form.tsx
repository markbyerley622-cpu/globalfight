"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DISCIPLINES = [
  "MMA", "Muay Thai", "Boxing", "BJJ", "Kickboxing", "Wrestling",
  "Judo", "Sambo", "Karate", "Taekwondo", "Strength", "Bare Knuckle",
];

const field =
  "w-full rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-chalk placeholder:text-fog focus:border-ink-600 focus:outline-none";

export function GymCreateForm() {
  const router = useRouter();
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setExisting(null);

    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get("name") ?? "").trim(),
      city: String(fd.get("city") ?? "").trim(),
      country: String(fd.get("country") ?? "").trim(),
      address: String(fd.get("address") ?? "").trim() || undefined,
      website: String(fd.get("website") ?? "").trim() || undefined,
      instagram: String(fd.get("instagram") ?? "").trim() || undefined,
      description: String(fd.get("description") ?? "").trim() || undefined,
      hoursNote: String(fd.get("hoursNote") ?? "").trim() || undefined,
      disciplines,
      makeHome: fd.get("makeHome") === "on",
    };

    try {
      const res = await fetch("/api/gyms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Could not add this gym.");
        // A duplicate is not a failure — it is a destination.
        if (d.existing) setExisting(d.existing);
        return;
      }
      router.push(`/gyms/${d.gym.slug}`);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3.5">
      <Label text="Gym name" required>
        <input name="name" required maxLength={80} placeholder="Tiger Muay Thai" className={field} />
      </Label>

      <div className="grid grid-cols-2 gap-3">
        <Label text="City" required>
          <input name="city" required maxLength={80} placeholder="Phuket" className={field} />
        </Label>
        <Label text="Country" required>
          <input name="country" required maxLength={80} placeholder="Thailand" className={field} />
        </Label>
      </div>

      <Label text="Street address" hint="Optional — helps people actually find it">
        <input name="address" maxLength={160} placeholder="7/6 Moo 5, Soi Ta-iad" className={field} />
      </Label>

      <fieldset>
        <legend className="mb-1.5 block font-display text-[0.72rem] font-bold uppercase tracking-wide text-mist">
          Disciplines
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {DISCIPLINES.map((d) => {
            const on = disciplines.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setDisciplines((cur) => (on ? cur.filter((x) => x !== d) : [...cur, d]))}
                className={cn(
                  "tap rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold transition-colors",
                  on
                    ? "border-volt-500 bg-volt-500/15 text-volt-400"
                    : "border-ink-700 bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Label text="About" hint="Optional">
        <textarea name="description" maxLength={600} rows={3} placeholder="What's it like to train here?" className={field} />
      </Label>

      <div className="grid grid-cols-2 gap-3">
        <Label text="Website" hint="Optional">
          <input name="website" type="url" maxLength={200} placeholder="https://…" className={field} />
        </Label>
        <Label text="Instagram" hint="Optional">
          <input name="instagram" maxLength={80} placeholder="@gym" className={field} />
        </Label>
      </div>

      <Label text="Hours" hint="Optional — free text">
        <input name="hoursNote" maxLength={160} placeholder="Mon–Fri 6am–9pm · Open mat Sat 11am" className={field} />
      </Label>

      <label className="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-3">
        <input name="makeHome" type="checkbox" defaultChecked className="size-4 accent-[var(--color-blood-500)]" />
        <span className="text-sm text-mist">This is my home gym</span>
      </label>

      {error && (
        <div className="rounded-xl border border-down/40 bg-down/10 px-3.5 py-3 text-sm text-down">
          {error}
          {existing && (
            <>
              {" "}
              <Link href={`/gyms/${existing}`} className="font-semibold underline underline-offset-2">
                Open it instead
              </Link>
            </>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="tap mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blood-500 px-5 py-3 font-display text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-blood-400 disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        Add gym
      </button>
    </form>
  );
}

function Label({
  text, hint, required, children,
}: { text: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-display text-[0.72rem] font-bold uppercase tracking-wide text-mist">
        {text}
        {!required && hint && <span className="ml-1.5 font-sans font-normal normal-case tracking-normal text-fog">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
