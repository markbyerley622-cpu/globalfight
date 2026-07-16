"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

const field =
  "h-11 w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50";

function ResetForm() {
  const t = useT();
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("The passwords don't match."));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t("Could not reset your password."));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <p className="text-sm text-mist">
        {t("This reset link is incomplete. Request a new one from the forgot-password page.")}
      </p>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-up/40 bg-up/10 p-3 text-sm text-chalk">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" />
          {/* Deliberately not auto-signed-in: proving you know the new password is
              the point of the reset. */}
          <span>{t("Password updated, and every existing session has been signed out. Please sign in with your new password.")}</span>
        </div>
        <Button className="w-full" onClick={() => router.push("/account")}>{t("Go to sign in")}</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-2.5 text-sm text-blood-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <input
        type="password" autoComplete="new-password" required
        value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder={t("New password (at least 10 characters)")} className={field}
      />
      <input
        type="password" autoComplete="new-password" required
        value={confirm} onChange={(e) => setConfirm(e.target.value)}
        placeholder={t("Confirm new password")} className={field}
      />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy
          ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> {t("Updating…")}</span>
          : t("Set new password")}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <PageHero eyebrow="Account" title="Set a new password" />
      <div className="container-cr py-10">
        <div className="card-surface mx-auto max-w-md p-6">
          <Suspense fallback={<Loader2 className="mx-auto size-5 animate-spin text-fog" />}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </>
  );
}
