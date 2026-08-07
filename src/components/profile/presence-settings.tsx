"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, Check, AlertCircle } from "lucide-react";
import { PresenceDot, PresenceLabel } from "@/components/presence/presence-dot";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Presence & privacy settings.
//
//  ── Why each switch states its consequence in full ────────────────────────
//  A settings screen that says "Show online status" and nothing else makes the
//  user guess what it covers — does it hide last seen too? does it stop me
//  seeing others? Guessing wrong about a privacy control is the failure mode
//  that matters, so every row says exactly what turning it off does, including
//  what it costs the person turning it off.
//
//  The two MUTUAL switches say so out loud. Somebody who does not know that
//  hiding their read receipts also hides everyone else's will feel deceived
//  when they notice, and they would be right to.
// ════════════════════════════════════════════════════════════════════════════

interface Prefs {
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  allowTypingIndicator: boolean;
  allowReadReceipts: boolean;
}

const ROWS: {
  key: keyof Prefs;
  label: string;
  help: string;
  /** Reciprocal — turning it off costs you the same signal from everyone else. */
  mutual?: boolean;
  /** Meaningless while showOnlineStatus is off. */
  dependsOnOnline?: boolean;
}[] = [
  {
    key: "showOnlineStatus",
    label: "Show when I'm online",
    help: "People see a green dot when you're active and an amber one when you've stepped away. Turn this off and nobody sees your status, your last seen, or that you were ever around.",
  },
  {
    key: "showLastSeen",
    label: "Show my last seen",
    help: "People can see roughly when you were last active — “Active 2h ago”. Turn it off to keep the live dot but hide the history.",
    dependsOnOnline: true,
  },
  {
    key: "allowTypingIndicator",
    label: "Send typing indicators",
    help: "People see when you're writing a reply. Turning this off also stops you seeing when they are.",
    mutual: true,
  },
  {
    key: "allowReadReceipts",
    label: "Send read receipts",
    help: "People see when you've read their message. Turning this off also stops you seeing when yours are read — both sides stop at “Delivered”.",
    mutual: true,
  },
];

export function PresenceSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<keyof Prefs | null>(null);
  /** Own heartbeat, so the preview shows a real state rather than a mock. */
  const [selfSeenAt, setSelfSeenAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = await res.json();
        const p = data.profile as Prefs | null;
        if (p) {
          setPrefs({
            showOnlineStatus: p.showOnlineStatus,
            showLastSeen: p.showLastSeen,
            allowTypingIndicator: p.allowTypingIndicator,
            allowReadReceipts: p.allowReadReceipts,
          });
        }
        setSelfSeenAt(new Date().toISOString());
      } catch {
        if (alive) setError("Could not load your presence settings.");
      }
    })();
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (key: keyof Prefs, value: boolean) => {
    // Optimistic: a privacy toggle that lags behind the finger makes people tap
    // it twice, and the second tap turns it back on.
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch {
      // Roll back. Leaving the switch showing a state the server never accepted
      // is the worst outcome on a privacy screen — the user would believe they
      // are hidden when they are not.
      setPrefs((p) => (p ? { ...p, [key]: !value } : p));
      setError("Could not save that. Your setting has not changed.");
    } finally {
      setBusy(null);
    }
  }, []);

  if (!prefs) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-ink-800 bg-ink-900/40 px-4 py-6 text-sm text-fog">
        <Loader2 className="size-4 animate-spin" /> Loading presence settings…
      </div>
    );
  }

  const hidden = !prefs.showOnlineStatus;

  return (
    <section className="rounded-card border border-ink-800 bg-ink-900/40">
      <header className="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
        <span className="flex items-center gap-2">
          <Eye className="size-4 text-blood-400" aria-hidden />
          <h2 className="font-display text-sm font-black uppercase tracking-wide text-chalk">
            Presence &amp; privacy
          </h2>
        </span>
        {saved && (
          <span className="flex items-center gap-1 text-2xs font-semibold text-up" role="status">
            <Check className="size-3.5" /> Saved
          </span>
        )}
      </header>

      {/* What everyone else currently sees — the honest preview. A settings
          screen that describes a result is weaker than one that shows it. */}
      <div className="flex items-center gap-3 border-b border-ink-800 bg-ink-950/40 px-4 py-3">
        <span className="relative inline-flex shrink-0">
          <span className="grid size-9 place-items-center rounded-full border border-ink-700 bg-ink-850 text-xs font-bold text-mist">
            You
          </span>
          <PresenceDot
            presence={{ lastSeenAt: selfSeenAt, hidden, showLastSeen: prefs.showLastSeen }}
            ringClassName="border-ink-950"
          />
        </span>
        <span className="min-w-0">
          <span className="block font-display text-xs font-bold text-chalk">
            What other people see
          </span>
          <PresenceLabel
            presence={{ lastSeenAt: selfSeenAt, hidden, showLastSeen: prefs.showLastSeen }}
            showHidden
            className="block"
          />
        </span>
      </div>

      <ul className="divide-y divide-ink-800">
        {ROWS.map((row) => {
          // A row that cannot do anything is disabled AND explained, rather
          // than silently ignored — a toggle that moves and changes nothing is
          // worse than one that will not move.
          const dead = row.dependsOnOnline && hidden;
          return (
            <li key={row.key} className="px-4 py-3.5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("font-display text-sm font-bold", dead ? "text-fog" : "text-chalk")}>
                      {row.label}
                    </span>
                    {row.mutual && (
                      <span className="rounded bg-volt-500/12 px-1.5 py-0.5 text-4xs font-bold uppercase tracking-wider text-volt-400">
                        Mutual
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-fog">
                    {dead
                      ? "Not in effect — your online status is hidden, which already hides this."
                      : row.help}
                  </p>
                </div>

                <Toggle
                  id={`presence-${row.key}`}
                  label={row.label}
                  checked={prefs[row.key]}
                  disabled={dead || busy === row.key}
                  busy={busy === row.key}
                  onChange={(v) => void save(row.key, v)}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 border-t border-blood-500/30 bg-blood-500/10 px-4 py-2.5 text-xs text-blood-300">
          <AlertCircle className="size-3.5 shrink-0" /> {error}
        </p>
      )}
    </section>
  );
}

/** A real checkbox under the paint, so it is focusable and reads correctly. */
function Toggle({
  id, label, checked, disabled, busy, onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        checked ? "bg-up" : "bg-ink-700",
      )}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "grid size-5 place-items-center rounded-full bg-white transition-transform",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-volt-400",
          checked ? "translate-x-[1.375rem]" : "translate-x-0.5",
        )}
      >
        {busy && <Loader2 className="size-3 animate-spin text-ink-700" />}
      </span>
    </label>
  );
}
