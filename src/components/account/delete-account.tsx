"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * DELETE ACCOUNT — the client half of an irreversible action.
 *
 * The server half (/api/auth/account/delete) already did the hard part: it
 * re-authenticates with the password, destroys identity documents in object
 * storage BEFORE the rows that point at them, writes an audit entry while the
 * actor still exists, cascades the delete and clears the session cookie. What
 * was missing was any way for a user to reach it — a GDPR Art. 17 route with no
 * button is not an erasure mechanism.
 *
 * ── Why the confirmation is what it is ────────────────────────────────────
 * Three gates, each removing a different failure:
 *   1. An "I understand" disclosure listing exactly what goes. Vague warnings
 *      produce both accidental deletions and people too scared to use a right
 *      they have.
 *   2. Typing DELETE. Defeats the muscle-memory double-tap; a checkbox does not.
 *   3. The account password, verified SERVER-side. This is the only gate that is
 *      actually security rather than UX — the other two live in the browser and
 *      an attacker with a stolen session skips them for free.
 */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = confirmText.trim().toUpperCase() === "DELETE";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Full document navigation, not router.push: every cached RSC payload in
        // the client router belongs to a user who no longer exists, and the
        // session cookie was cleared by the response. A soft navigation would
        // render those stale payloads.
        window.location.href = "/";
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "That didn't go through. Please try again.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-card border border-blood-500/40 bg-blood-500/[0.06] p-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-blood-200">
        <AlertTriangle aria-hidden className="size-4" /> Danger zone
      </h2>

      {!open ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-fog">
            Deleting your account is permanent and cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="tap mt-3 inline-flex min-h-11 items-center rounded-lg border border-blood-500/50 px-4 py-2 text-sm font-semibold text-blood-200 transition-colors hover:bg-blood-500/15"
          >
            Delete account
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          {/* EXACTLY what goes, and what does not. A user deciding whether to
              erase themselves is entitled to the specifics, and the honest
              detail — that their posts stay as "Deleted User" — is the one most
              likely to change the decision, so it is stated plainly rather than
              discovered afterwards. */}
          <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-3 text-xs leading-relaxed text-mist">
            <p className="font-semibold text-chalk">This permanently deletes:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fog">
              <li>your profile, display name, handle and photos</li>
              <li>your predictions, reputation and streaks</li>
              <li>your follows, followers and challenges</li>
              <li>your notifications, sessions and saved items</li>
              <li>any identity documents you uploaded</li>
            </ul>
            <p className="mt-2 text-fog">
              Discussion you posted stays on the thread it belongs to, attributed to{" "}
              <span className="text-mist">Deleted User</span> — removing it outright would
              tear holes in conversations other people are part of.
            </p>
          </div>

          <label className="block">
            <span className="block text-2xs font-semibold uppercase tracking-wide text-fog">
              Type DELETE to confirm
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              aria-label="Type DELETE to confirm"
              className="mt-1 h-11 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 text-sm text-chalk outline-none focus:border-blood-500"
            />
          </label>

          <label className="block">
            <span className="block text-2xs font-semibold uppercase tracking-wide text-fog">
              Your password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 h-11 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 text-sm text-chalk outline-none focus:border-blood-500"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!armed || busy}
              className={cn(
                "tap inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors",
                armed && !busy
                  ? "bg-blood-600 text-white hover:bg-blood-500"
                  : "cursor-not-allowed bg-ink-800 text-fog",
              )}
            >
              {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Permanently delete my account
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirmText(""); setPassword(""); setError(null); }}
              className="tap min-h-11 px-3 text-sm font-semibold text-fog hover:text-chalk"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
