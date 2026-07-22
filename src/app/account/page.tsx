"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Mail, Lock, User, Heart, Bookmark, Bell, ShieldCheck, Check, Loader2, AlertCircle, LogOut,
} from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-client";
import { track } from "@/lib/analytics-client";
import { AGE_STATEMENT, MINIMUM_AGE } from "@/lib/age-policy";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { cn } from "@/lib/utils";
import { ROLE_GROUPS, rolesInGroup, roleLabel } from "@/lib/roles";
import { FighterProfilePanel } from "@/components/fighters/fighter-profile-panel";

const FEATURES = [
  { icon: Heart, t: "Favorite fighters", d: "Follow your favorites and get their fight alerts." },
  { icon: Bookmark, t: "Saved predictions", d: "Track your picks and see how you stack up." },
  { icon: ShieldCheck, t: "Claim your profile", d: "Verify and manage your registry entry." },
  { icon: Bell, t: "Notifications", d: "Fight-week reminders and breaking news." },
];

export default function AccountPage() {
  const t = useT();
  const { user, loading, signup, login, logout } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [role, setRole] = useState<string>("fan");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    // Same check the API runs, so the form can't drift from the policy again.
    if (isSignup) {
      const weak = checkPassword(password);
      if (weak) {
        setError(weak);
        return;
      }
    }
    if (isSignup && !ageConfirmed) {
      setError(`You must confirm you are at least ${MINIMUM_AGE} to create an account.`);
      return;
    }
    setSubmitting(true);
    try {
      if (isSignup) {
        await signup({ name, email, password, registryRole: role, ageConfirmed });
        track("signup", { role });
        setSuccess("Account created — you're signed in.");
      } else {
        await login(email, password);
        setSuccess("Signed in.");
      }
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Logged-in dashboard ──────────────────────────────────────────────
  if (!loading && user) {
    const roleName = roleLabel(user.registryRole);
    return (
      <>
        <PageHero
          eyebrow="Members"
          title={`Welcome${user.name ? `, ${user.name.split(" ")[0]}` : ""}`}
          description="Your Combat Reviews account. Manage your profile, follows and registry claims."
        />
        <div className="container-cr grid gap-6 py-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="card-surface p-6">
            <div className="flex items-center gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-blood-500/15 font-display text-xl font-bold text-blood-300">
                {(user.name ?? user.username ?? user.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-bold text-chalk">{user.name ?? user.username}</p>
                <p className="truncate text-sm text-fog">{user.email}</p>
              </div>
            </div>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between"><dt className="text-fog">Registry role</dt><dd className="font-semibold text-chalk">{roleName}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-fog">Username</dt><dd className="font-semibold text-chalk">@{user.username}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-fog">Reputation</dt><dd className="font-semibold text-chalk">{user.reputation}</dd></div>
            </dl>
            <button
              onClick={() => logout()}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-ink-700 px-4 py-2.5 font-display text-xs font-semibold uppercase tracking-wide text-mist transition-colors hover:border-blood-500/50 hover:text-blood-300"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/registry" className="card-surface flex flex-col justify-between gap-3 p-5 transition-colors hover:border-blood-500/40">
              <ShieldCheck className="size-6 text-blood-400" />
              <div><p className="font-display text-sm font-bold text-chalk">Claim your profile</p><p className="text-sm text-mist">Find your registry entry and claim it.</p></div>
            </Link>
            <Link href="/fighters" className="card-surface flex flex-col justify-between gap-3 p-5 transition-colors hover:border-blood-500/40">
              <Heart className="size-6 text-blood-400" />
              <div><p className="font-display text-sm font-bold text-chalk">Follow fighters</p><p className="text-sm text-mist">Build your favorites list.</p></div>
            </Link>
            <Link href="/forums" className="card-surface flex flex-col justify-between gap-3 p-5 transition-colors hover:border-blood-500/40">
              <Bookmark className="size-6 text-blood-400" />
              <div><p className="font-display text-sm font-bold text-chalk">Join the forums</p><p className="text-sm text-mist">Post, reply and build reputation.</p></div>
            </Link>
            <Link href="/predictions" className="card-surface flex flex-col justify-between gap-3 p-5 transition-colors hover:border-blood-500/40">
              <Bell className="size-6 text-blood-400" />
              <div><p className="font-display text-sm font-bold text-chalk">Make predictions</p><p className="text-sm text-mist">Track your picks vs the model.</p></div>
            </Link>
          </div>
        </div>
        {user.registryRole === "fighter" && (
          <div className="container-cr pb-10">
            <FighterProfilePanel defaultName={user.name ?? undefined} />
          </div>
        )}
      </>
    );
  }

  // ── Auth form ────────────────────────────────────────────────────────
  return (
    <>
      <PageHero
        eyebrow="Join the registry"
        title={isSignup ? "Create your account" : "Welcome back"}
        description="Join the Combat Reviews community — follow fighters, predict fights and discuss. Fighters can verify and claim their profile once you're in."
      />
      <div className="container-cr grid gap-8 py-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="card-surface p-5 sm:p-8">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-ink-700 bg-ink-950/50 p-1">
            {(["signup", "signin"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); setSuccess(null); }}
                className={cn(
                  "rounded-lg py-2.5 font-display text-xs font-bold uppercase tracking-wide transition-colors",
                  mode === m ? "bg-blood-500 text-white" : "text-mist hover:text-chalk",
                )}
              >
                {m === "signup" ? t("Create account") : t("Sign in")}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-blood-500/40 bg-blood-500/10 p-3 text-sm text-blood-200">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-up/40 bg-up/10 p-3 text-sm text-up">
              <Check className="mt-0.5 size-4 shrink-0" /> <span>{success}</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={onSubmit}>
            {isSignup && (
              <>
                <div>
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fog">
                    I&rsquo;m joining as…
                  </span>
                  <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fog">
                    Everyone in combat sports has a place here. Pick the closest — you can change it any time from
                    your profile.
                  </p>
                  <div className="space-y-3">
                    {ROLE_GROUPS.map((g) => (
                      <div key={g.id}>
                        <span className="mb-1.5 block font-display text-[0.6rem] font-bold uppercase tracking-[0.16em] text-fog">
                          {g.label}
                        </span>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {rolesInGroup(g.id).map((r) => {
                            const on = role === r.value;
                            return (
                              <button
                                key={r.value}
                                type="button"
                                onClick={() => setRole(r.value)}
                                aria-pressed={on}
                                title={r.blurb}
                                className={cn(
                                  "tap flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors",
                                  on
                                    ? "border-blood-500/60 bg-blood-500/10"
                                    : "border-ink-700 bg-ink-950/40 hover:border-ink-600",
                                )}
                              >
                                <span className="flex w-full items-center justify-between gap-1">
                                  <span className="font-display text-[0.72rem] font-bold leading-tight text-chalk">
                                    {r.label}
                                  </span>
                                  {on && <Check className="size-3.5 shrink-0 text-blood-400" />}
                                </span>
                                <span className="text-[0.6rem] leading-tight text-fog">{r.blurb}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <Field icon={User} label="Username" type="text" placeholder="Choose a username" value={name} onChange={setName} autoComplete="username" />
              </>
            )}

            <Field icon={Mail} label="Email" type="email" placeholder="you@example.com" value={email} onChange={setEmail} required autoComplete="email" />
            <Field icon={Lock} label="Password" type="password" placeholder={isSignup ? `At least ${MIN_PASSWORD_LENGTH} characters` : "Your password"} value={password} onChange={setPassword} required autoComplete={isSignup ? "new-password" : "current-password"} />

            {isSignup && (
              <>
                <label className="flex items-start gap-2 text-xs text-mist">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-blood-500"
                    checked={ageConfirmed}
                    onChange={(e) => setAgeConfirmed(e.target.checked)}
                    required
                  />
                  <span>{t(AGE_STATEMENT)}</span>
                </label>
                <label className="flex items-start gap-2 text-xs text-mist">
                  <input type="checkbox" className="mt-0.5 size-4 accent-blood-500" required />
                  <span>
                    I agree that public, source-backed professional information may appear in the registry, and I will not
                    submit private personal data of others.
                  </span>
                </label>
              </>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> {isSignup ? "Creating…" : "Signing in…"}</span>
              ) : (
                isSignup ? t("Create account") : t("Sign in")
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-fog">
            {isSignup ? (
              <>Already have an account?{" "}
                <button onClick={() => { setMode("signin"); setError(null); }} className="font-semibold text-blood-400 hover:text-blood-300">{t("Sign in")}</button>
              </>
            ) : (
              <>New here?{" "}
                <button onClick={() => { setMode("signup"); setError(null); }} className="font-semibold text-blood-400 hover:text-blood-300">{t("Create an account")}</button>
              </>
            )}
          </p>
        </div>

        <div className="space-y-4">
          <h2 className="font-display text-lg font-bold uppercase text-chalk">{t("Member features")}</h2>
          {FEATURES.map((f) => (
            <div key={f.t} className="card-surface flex items-start gap-4 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blood-500/15 text-blood-400">
                <f.icon className="size-5" />
              </div>
              <div>
                <p className="font-display text-sm font-bold text-chalk">{t(f.t)}</p>
                <p className="text-sm text-mist">{t(f.d)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Field({
  icon: Icon, label, type, placeholder, value, onChange, required, autoComplete,
}: {
  icon: typeof Mail; label: string; type: string; placeholder: string;
  value: string; onChange: (v: string) => void; required?: boolean; autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-fog">{label}</span>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/50 px-3 focus-within:border-blood-500/50">
        <Icon className="size-4 text-fog" />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          className="h-11 flex-1 bg-transparent text-sm text-chalk outline-none placeholder:text-fog"
        />
      </div>
    </label>
  );
}
