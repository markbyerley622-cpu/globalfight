"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Check, Moon, AlertCircle } from "lucide-react";
import { CATEGORIES, type NotifCategory } from "@/lib/push/policy";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Notification settings + the push opt-in.
//
//  Permission is requested from a BUTTON the user pressed, never on page load.
//  A cold `Notification.requestPermission()` is the fastest way to a permanent
//  "Block", and browsers only ever ask once — a denied prompt cannot be
//  re-requested, so a wasted one costs that user push forever.
//
//  Categories and quiet hours apply to the IN-APP notification list too, so the
//  toggles are meaningful even where push is unavailable (iOS Safari outside a
//  home-screen install, or a server with no VAPID keys).
// ════════════════════════════════════════════════════════════════════════════

type Prefs = {
  notifyFights: boolean;
  notifyPredictions: boolean;
  notifySocial: boolean;
  notifyGym: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
};

const KEY_OF: Record<NotifCategory, keyof Prefs> = {
  fights: "notifyFights",
  predictions: "notifyPredictions",
  social: "notifySocial",
  gym: "notifyGym",
};

/** base64url → ArrayBuffer, the format PushManager expects for the VAPID key.
 *  Returns the buffer rather than the view: lib.dom types applicationServerKey
 *  as ArrayBuffer-backed, and a Uint8Array over a generic ArrayBufferLike does
 *  not satisfy it. */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [pushState, setPushState] = useState<"unsupported" | "unconfigured" | "off" | "on" | "denied" | "working">("off");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d?.profile) setPrefs(d.profile); })
      .catch(() => {});

    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (live) setPushState("unsupported");
        return;
      }
      const cfg = await fetch("/api/push/subscribe").then((r) => r.json()).catch(() => null);
      if (!live) return;
      if (!cfg?.configured) { setPushState("unconfigured"); return; }
      if (Notification.permission === "denied") { setPushState("denied"); return; }
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      if (live) setPushState(sub ? "on" : "off");
    })();

    return () => { live = false; };
  }, []);

  const save = useCallback(async (patch: Partial<Prefs>) => {
    setPrefs((cur) => (cur ? { ...cur, ...patch } : cur));
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save.");
      const d = await res.json();
      setPrefs(d.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }, []);

  async function enablePush() {
    setPushState("working");
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setPushState(permission === "denied" ? "denied" : "off"); return; }

      const cfg = await fetch("/api/push/subscribe").then((r) => r.json());
      if (!cfg?.publicKey) throw new Error("Push is not configured on this server.");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(cfg.publicKey),
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not register this device.");
      setPushState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications.");
      setPushState("off");
    }
  }

  async function disablePush() {
    setPushState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
        await sub.unsubscribe();
      }
      setPushState("off");
    } catch {
      setPushState("on");
    }
  }

  if (!prefs) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-5 text-sm text-fog">
        <Loader2 className="size-4 animate-spin" /> Loading notification settings…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
      {/* Push opt-in */}
      <div className="flex items-start gap-3 border-b border-ink-800 px-4 py-3.5">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", pushState === "on" ? "bg-up/15 text-up" : "bg-ink-800 text-fog")}>
          {pushState === "on" ? <Bell className="size-[1.05rem]" /> : <BellOff className="size-[1.05rem]" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Push notifications</p>
          <p className="mt-0.5 text-[0.76rem] leading-relaxed text-fog">
            {pushState === "on" && "This device will get fight reminders and replies, even when the app is closed."}
            {pushState === "off" && "Get fight reminders and replies when the app is closed."}
            {pushState === "denied" && "Blocked in your browser settings. Re-allow notifications for this site, then reload."}
            {pushState === "unsupported" && "This browser can't do push. On iPhone, add the app to your home screen first."}
            {pushState === "unconfigured" && "Push isn't set up on this server yet. In-app notifications still work."}
            {pushState === "working" && "…"}
          </p>
        </div>
        {(pushState === "off" || pushState === "on") && (
          <button
            type="button"
            onClick={pushState === "on" ? disablePush : enablePush}
            className={cn(
              "tap shrink-0 rounded-lg px-3 py-2 font-display text-[0.68rem] font-bold uppercase tracking-wide transition-colors",
              pushState === "on"
                ? "border border-ink-600 bg-ink-800 text-chalk hover:border-ink-500"
                : "bg-blood-500 text-white hover:bg-blood-400",
            )}
          >
            {pushState === "on" ? "Turn off" : "Enable"}
          </button>
        )}
        {pushState === "working" && <Loader2 className="mt-2 size-4 shrink-0 animate-spin text-fog" />}
      </div>

      {/* Categories */}
      <div className="px-4 py-3.5">
        <p className="mb-2 flex items-center justify-between font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist">
          What to tell me about
          {saved && <Check className="size-3.5 text-up" />}
        </p>
        <div className="flex flex-col gap-1.5">
          {CATEGORIES.map((c) => {
            const key = KEY_OF[c.id];
            const on = prefs[key] as boolean;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => save({ [key]: !on } as Partial<Prefs>)}
                aria-pressed={on}
                className={cn(
                  "tap flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  on ? "border-blood-500/40 bg-blood-500/10" : "border-ink-700 bg-ink-850 hover:border-ink-600",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.82rem] font-semibold text-chalk">{c.label}</span>
                  <span className="block text-[0.68rem] leading-relaxed text-fog">{c.help}</span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    on ? "bg-blood-500" : "bg-ink-700",
                  )}
                >
                  <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", on ? "left-[1.125rem]" : "left-0.5")} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Quiet hours */}
        <p className="mb-2 mt-4 flex items-center gap-1.5 font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist">
          <Moon className="size-3" /> Quiet hours
        </p>
        <p className="mb-2 text-[0.68rem] leading-relaxed text-fog">
          Push is held during these hours. Notifications still arrive in the app — you just aren&apos;t woken by them.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            size="sm"
            tone="neutral"
            active={prefs.quietHoursStart === null}
            onClick={() => save({ quietHoursStart: null, quietHoursEnd: null })}
          >
            Always on
          </Chip>
          {([[22, 7], [23, 8], [0, 6]] as const).map(([s, e]) => (
            <Chip
              key={`${s}-${e}`}
              size="sm"
              tone="neutral"
              active={prefs.quietHoursStart === s && prefs.quietHoursEnd === e}
              onClick={() =>
                save({
                  quietHoursStart: s,
                  quietHoursEnd: e,
                  // Captured from the browser so "10pm" means the user's 10pm
                  // and survives them travelling.
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
                })
              }
            >
              {String(s).padStart(2, "0")}:00–{String(e).padStart(2, "0")}:00
            </Chip>
          ))}
        </div>
        {prefs.timezone && prefs.quietHoursStart !== null && (
          <p className="mt-1.5 text-[0.66rem] text-fog">Times are in {prefs.timezone}.</p>
        )}

        {error && (
          <p role="alert" className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-down">
            <AlertCircle className="size-3.5 shrink-0" /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
