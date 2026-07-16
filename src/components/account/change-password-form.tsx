"use client";

import { useState } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

const field =
  "h-11 w-full rounded-lg border border-ink-700 bg-ink-950/50 px-3 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50";

export function ChangePasswordForm() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError(t("The new passwords don't match."));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t("Could not change your password."));
      setDone(true);
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-up/40 bg-up/10 p-3 text-sm text-chalk">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" />
        <span>
          {t("Password updated. You've been signed out on every other device.")}
        </span>
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
        type="password" autoComplete="current-password" required
        value={current} onChange={(e) => setCurrent(e.target.value)}
        placeholder={t("Current password")} className={field}
      />
      <input
        type="password" autoComplete="new-password" required
        value={next} onChange={(e) => setNext(e.target.value)}
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
          : t("Change password")}
      </Button>
      <p className="text-center text-[0.65rem] text-fog">
        {t("Changing your password signs you out everywhere else.")}
      </p>
    </form>
  );
}
