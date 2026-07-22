"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "cr-install-dismissed";

// A subtle, dismissible "Add to home screen" prompt on Android/Chrome (which fire
// beforeinstallprompt). iOS has no such event, so we simply don't nag there.
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return; // already installed
    if (localStorage.getItem(DISMISS_KEY)) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden || !deferred) return null;

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — fine */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setHidden(true);
    setDeferred(null);
  }

  return (
    <div className="fixed inset-x-3 bottom-20 z-[140] mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/95 px-4 py-3 shadow-lg backdrop-blur sm:bottom-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blood-500/15 text-blood-300">
        <Download className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-chalk">Install Combat Reviews</p>
        <p className="text-xs text-fog">Add to your home screen — full-screen, one tap.</p>
      </div>
      <button
        onClick={install}
        className="shrink-0 rounded-lg bg-blood-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blood-600"
      >
        Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-fog hover:text-chalk">
        <X className="size-4" />
      </button>
    </div>
  );
}
