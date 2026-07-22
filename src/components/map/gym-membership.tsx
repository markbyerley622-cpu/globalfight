"use client";

import { useState } from "react";
import { Loader2, Home, UserPlus, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Join / leave a gym and set it as your home gym.
 *
 * Two buttons rather than one three-state control: "I train here" and "this is
 * my main gym" are genuinely different claims, and a fighter who trains at
 * three gyms needs to be able to say so without demoting the other two.
 */
export function GymMembershipButtons({
  slug, initialMember, initialIsHome, initialCount, signedIn,
}: {
  slug: string;
  initialMember: boolean;
  initialIsHome: boolean;
  initialCount: number;
  signedIn: boolean;
}) {
  const [member, setMember] = useState(initialMember);
  const [isHome, setIsHome] = useState(initialIsHome);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState<null | "join" | "home">(null);
  const [error, setError] = useState<string | null>(null);

  async function send(body: { join: boolean; isHome?: boolean }, kind: "join" | "home") {
    if (!signedIn) { window.location.href = "/account"; return; }
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/gyms/${encodeURIComponent(slug)}/membership`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
      const d = await res.json();
      setMember(!!d.member);
      setIsHome(!!d.isHome);
      if (typeof d.memberCount === "number") setCount(d.memberCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => send({ join: !member }, "join")}
          aria-pressed={member}
          className={cn(
            "tap inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide transition-colors disabled:opacity-60",
            member
              ? "border border-ink-600 bg-ink-800 text-chalk hover:border-ink-500"
              : "bg-volt-500 text-ink-950 hover:bg-volt-400",
          )}
        >
          {busy === "join" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : member ? (
            <UserMinus className="size-3.5" />
          ) : (
            <UserPlus className="size-3.5" />
          )}
          {member ? "Training here" : "I train here"}
          <span className="tabular-nums opacity-60">· {count}</span>
        </button>

        {member && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => send({ join: true, isHome: !isHome }, "home")}
            aria-pressed={isHome}
            className={cn(
              "tap inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide transition-colors disabled:opacity-60",
              isHome
                ? "border-gold-500/50 bg-gold-500/15 text-gold-300"
                : "border-ink-700 text-mist hover:border-ink-600 hover:text-chalk",
            )}
          >
            {busy === "home" ? <Loader2 className="size-3.5 animate-spin" /> : <Home className="size-3.5" />}
            {isHome ? "Home gym" : "Set as home"}
          </button>
        )}
      </div>
      {error && <p className="text-[0.66rem] text-down">{error}</p>}
    </div>
  );
}
