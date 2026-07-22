"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Fight alerts.
//
//  This toggles `User.notifyFights` and NOTHING ELSE. There is deliberately no
//  per-fighter alert preference: the push policy has one "fights" category
//  (lib/push/policy) that already governs event reminders, bookings and going
//  live, and inventing a second store here would mean two switches that can
//  disagree about whether you get told — the exact failure the policy exists to
//  prevent.
//
//  Because the preference is GLOBAL, the state lives in a context above the
//  feed rather than inside each card. Ten fighter cards on screen are ten views
//  of one value: flipping any of them flips all of them instantly, which is
//  honest. Per-card state would show one card "on" and nine "off" for the same
//  underlying setting.
//
//  The wording is careful for the same reason. It says "Fight alerts", never
//  "Alerts for John Smith" — the card must not promise something narrower than
//  what the switch does.
// ════════════════════════════════════════════════════════════════════════════

const AlertsCtx = createContext<{
  on: boolean;
  busy: boolean;
  toggle: () => void;
  signedIn: boolean;
}>({ on: false, busy: false, toggle: () => {}, signedIn: false });

export function AlertsProvider({
  initial,
  signedIn,
  children,
}: {
  initial: boolean;
  signedIn: boolean;
  children: ReactNode;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(() => {
    if (!signedIn) { window.location.href = "/account"; return; }
    if (busy) return;
    const next = !on;
    setOn(next);            // optimistic — the switch answers the thumb, not the network
    setBusy(true);
    fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notifyFights: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("failed");
        return r.json();
      })
      // Trust the server's value over the optimistic one: a session that
      // expired mid-flight must not leave the UI claiming a saved setting.
      .then((d) => setOn(!!d?.profile?.notifyFights))
      .catch(() => setOn(!next))
      .finally(() => setBusy(false));
  }, [on, busy, signedIn]);

  return <AlertsCtx.Provider value={{ on, busy, toggle, signedIn }}>{children}</AlertsCtx.Provider>;
}

export function AlertsToggle({ className }: { className?: string }) {
  const { on, busy, toggle } = useContext(AlertsCtx);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-busy={busy}
      aria-label={on ? "Fight alerts enabled" : "Fight alerts disabled"}
      title="Alerts for every fight you follow"
      className={cn(
        "inline-flex min-h-11 items-center gap-1 rounded-md px-2 py-1 font-display text-[0.6rem] font-bold uppercase tracking-wide transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
        on ? "bg-blood-500/12 text-blood-300 hover:bg-blood-500/20" : "bg-ink-800 text-fog hover:text-chalk",
        busy && "opacity-60",
        className,
      )}
    >
      {on ? <Bell className="size-3" /> : <BellOff className="size-3" />}
      {on ? "Alerts on" : "Alerts off"}
    </button>
  );
}
