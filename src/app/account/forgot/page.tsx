"use client";

import { useState } from "react";
import { Loader2, AlertCircle, MailCheck } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      // 503 = email provider genuinely unavailable. Anything else is the generic
      // "if that email is registered…" — we never reveal whether it was.
      if (res.status === 503 || res.status === 429) {
        throw new Error(data.error ?? t("Password reset is temporarily unavailable."));
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHero eyebrow="Account" title="Reset your password" />
      <div className="container-cr py-10">
        <div className="card-surface mx-auto max-w-md p-6">
          {sent ? (
            <div className="flex items-start gap-2 rounded-lg border border-up/40 bg-up/10 p-3 text-sm text-chalk">
              <MailCheck className="mt-0.5 size-4 shrink-0 text-up" />
              <span>{t("If that email is registered, we've sent a reset link. It expires in 30 minutes and works once.")}</span>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <p className="text-sm text-mist">
                {t("Enter your email and we'll send you a link to set a new password.")}
              </p>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-2.5 text-sm text-blood-200">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <input
                type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder={t("you@example.com")}
                className="h-11 w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy
                  ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> {t("Sending…")}</span>
                  : t("Send reset link")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
