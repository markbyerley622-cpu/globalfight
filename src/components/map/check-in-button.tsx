"use client";

import { useState } from "react";
import { Loader2, MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Check in / out of a gym or event.
 *
 * Optimistic: the count moves on tap and rolls back if the request fails. A
 * check-in is a low-stakes, high-frequency action — waiting on a round trip to
 * confirm "I'm at the gym" is the difference between a habit and a chore.
 */
export function CheckInButton({
  gymId,
  eventId,
  initialHere,
  initialChecked,
  signedIn,
  className,
}: {
  gymId?: string;
  eventId?: string;
  initialHere: number;
  initialChecked: boolean;
  signedIn: boolean;
  className?: string;
}) {
  const [here, setHere] = useState(initialHere);
  const [checked, setChecked] = useState(initialChecked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!signedIn) { setError("Sign in to check in."); return; }
    const next = !checked;
    setChecked(next);
    setHere((n) => Math.max(0, n + (next ? 1 : -1)));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/map/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gymId, eventId, action: next ? "in" : "out" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not check in.");
      // Trust the server's count over the optimistic one — someone else may
      // have arrived or left in the meantime.
      const data = await res.json();
      if (typeof data?.presence?.count === "number") setHere(data.presence.count);
    } catch (e) {
      setChecked(!next);
      setHere((n) => Math.max(0, n + (next ? -1 : 1)));
      setError(e instanceof Error ? e.message : "Could not check in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={checked}
        className={cn(
          "tap inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide transition-colors disabled:opacity-60",
          checked
            ? "border border-up/40 bg-up/15 text-up"
            : "bg-blood-500 text-white hover:bg-blood-400",
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : checked ? (
          <Check className="size-3.5" />
        ) : (
          <MapPin className="size-3.5" />
        )}
        {checked ? "You're here" : "Check in"}
        {here > 0 && <span className="tabular-nums opacity-70">· {here}</span>}
      </button>
      {error && <p className="text-[0.66rem] text-down">{error}</p>}
    </div>
  );
}
