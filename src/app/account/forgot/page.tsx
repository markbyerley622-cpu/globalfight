"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertCircle, MailCheck } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
//  Account recovery — both kinds, on one page.
//
//  Password and username recovery ask the same question ("what is your email?")
//  and give the same answer ("if that's registered, check your inbox"). Two pages
//  would mean two forms, two copies of the generic-response rule and a user who
//  picked the wrong one having to navigate to the other. A mode toggle is one form.
//
//  ?mode=username deep-links the second tab, so the sign-in screen can offer
//  "Forgot username?" directly.
// ════════════════════════════════════════════════════════════════════════════

type Mode = "password" | "username";

const MODES: { id: Mode; tab: string; title: string; blurb: string; endpoint: string; sent: string }[] = [
  {
    id: "password",
    tab: "Password",
    title: "Reset your password",
    blurb: "Enter your email and we'll send you a link to set a new password.",
    endpoint: "/api/auth/password/reset/request",
    sent: "If that email is registered, we've sent a reset link. It expires in 30 minutes and works once.",
  },
  {
    id: "username",
    tab: "Username",
    title: "Recover your username",
    blurb: "Enter your email and we'll send your username to it. You sign in with your email, so you only need this to find your public profile link.",
    endpoint: "/api/auth/username/remind",
    // Deliberately identical in shape to the password message: a different reply
    // for a registered address would make this an account-existence oracle.
    sent: "If that email is registered, we've sent the username to it.",
  },
];

export default function ForgotPage() {
  const t = useT();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "username" ? "username" : "password");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(active.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      // 503 = the mail provider is genuinely unavailable; 429 = rate limited.
      // Anything else is the generic "if that email is registered…", and we never
      // reveal which it was.
      if (res.status === 503 || res.status === 429) {
        throw new Error(data.error ?? t("Recovery is temporarily unavailable."));
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    // Clearing the sent/error state matters: leaving "check your inbox" on screen
    // after switching tabs implies the OTHER email was sent too.
    setSent(false);
    setError(null);
  }

  return (
    <>
      <PageHero eyebrow="Account" title={t(active.title)} />
      <div className="container-cr py-10">
        <div className="card-surface mx-auto max-w-md p-6">
          <div role="tablist" aria-label={t("What do you need to recover?")} className="mb-4 flex gap-1 rounded-lg border border-ink-700 bg-ink-950/40 p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                type="button"
                aria-selected={mode === m.id}
                onClick={() => switchMode(m.id)}
                className={cn(
                  "tap flex-1 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
                  mode === m.id ? "bg-blood-500/15 text-blood-200" : "text-fog hover:text-mist",
                )}
              >
                {t(m.tab)}
              </button>
            ))}
          </div>

          {sent ? (
            <div className="flex items-start gap-2 rounded-lg border border-up/40 bg-up/10 p-3 text-sm text-chalk" role="status">
              <MailCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-up" />
              <span>{t(active.sent)}</span>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <p className="text-sm text-mist">{t(active.blurb)}</p>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-2.5 text-sm text-blood-200" role="alert">
                  <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <label className="block">
                <span className="sr-only">{t("Email address")}</span>
                <input
                  type="email" autoComplete="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("you@example.com")}
                  className="h-11 w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
                />
              </label>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy
                  ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> {t("Sending…")}</span>
                  : t(mode === "password" ? "Send reset link" : "Send my username")}
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-xs text-fog">
            <Link href="/account" className="underline underline-offset-2 transition-colors hover:text-mist">
              {t("Back to sign in")}
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
