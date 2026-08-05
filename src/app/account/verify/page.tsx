"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2, MailCheck } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";

const RESEND_COOLDOWN = 60;

/**
 * Confirm the email address on the signed-in account.
 *
 * The resend button is the whole point of this screen, so it is never hidden —
 * a code that never arrived is the failure mode people actually hit, and a
 * screen that only offers an input box for a code you do not have is a dead end.
 * The countdown mirrors the server's cooldown; the server is still the control,
 * and a 429 from it re-syncs the timer rather than being shown as an error.
 */
export default function VerifyEmailPage() {
  const t = useT();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsResend, setNeedsResend] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // One interval for the countdown, torn down when it reaches zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const resend = useCallback(async () => {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/verify/request", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429 && typeof data.retryAfter === "number") {
        // Not an error the user caused — just re-sync to the server's clock.
        setCooldown(data.retryAfter);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? t("Could not send the code."));
      if (data.alreadyVerified) { setDone(true); return; }

      setNeedsResend(false);
      setCooldown(data.cooldown ?? RESEND_COOLDOWN);
      setNotice(t("We've sent a new code. Check your inbox."));
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not send the code."));
    } finally {
      setSending(false);
    }
  }, [t]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNeedsResend(Boolean(data.needsResend));
        throw new Error(data.error ?? t("Could not verify that code."));
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not verify that code."));
      setCode("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-fog">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <PageHero eyebrow={t("Account")} title={t("Verify your email")} />
        <div className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
          <div className="card-surface p-6 text-center">
            <p className="text-sm text-mist">{t("Sign in to verify your email address.")}</p>
            <Button onClick={() => router.push("/account")} size="sm" className="mt-4 px-4">
              {t("Sign in")}
            </Button>
          </div>
        </div>
      </>
    );
  }

  if (done) {
    return (
      <>
        <PageHero eyebrow={t("Account")} title={t("Email verified")} />
        <div className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
          <div className="card-surface flex flex-col items-center gap-3 p-6 text-center">
            <CheckCircle2 className="size-8 text-up" />
            <p className="text-sm text-mist">{t("Your email address is confirmed.")}</p>
            <Button onClick={() => router.push("/account")} size="sm" className="mt-1 px-4">
              {t("Back to your account")}
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero eyebrow={t("Account")} title={t("Verify your email")} />
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
        <form onSubmit={submit} className="card-surface p-6">
          <div className="flex flex-col items-center text-center">
            <MailCheck className="size-7 text-blood-400" />
            <p className="mt-3 text-sm text-mist">
              {t("We sent a 6-digit code to")}{" "}
              <span className="font-semibold text-chalk">{user.email}</span>
            </p>
          </div>

          <label htmlFor="verify-code" className="sr-only">{t("Verification code")}</label>
          <input
            id="verify-code"
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            // inputMode + autoComplete let iOS and Android offer the code straight
            // from the notification, which is the difference between one tap and
            // switching apps to copy it by hand.
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="000000"
            aria-describedby={error ? "verify-error" : undefined}
            className="mt-5 h-14 w-full rounded-lg border border-ink-700 bg-ink-950/50 text-center font-display text-2xl font-bold tracking-[0.4em] text-chalk outline-none placeholder:text-fog/40 focus:border-blood-500/50"
          />

          {error && (
            <p id="verify-error" role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-xs text-down">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-up/40 bg-up/10 px-3 py-2.5 text-xs text-up">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> {notice}
            </p>
          )}

          <Button type="submit" disabled={busy || code.length !== 6} size="md" className="mt-4 w-full">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("Verify")}
          </Button>

          <div className="mt-4 border-t border-ink-800 pt-4 text-center">
            <p className="text-2xs text-fog">{t("Didn't get it? Check spam, then resend.")}</p>
            <Button
              type="button"
              onClick={resend}
              disabled={sending || cooldown > 0}
              variant={needsResend ? "primary" : "ghost"}
              size="sm"
              className="mt-2"
            >
              {sending && <Loader2 className="size-3.5 animate-spin" />}
              {cooldown > 0 ? t("Resend in {n}s").replace("{n}", String(cooldown)) : t("Resend code")}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
