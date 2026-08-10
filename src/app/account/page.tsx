"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Mail, Lock, User, Heart, Bookmark, Bell, ShieldCheck, Check, Loader2, AlertCircle, LogOut,
  BadgeCheck, ArrowRight, MessageSquarePlus,
} from "lucide-react";
import { isProfessionalRole } from "@/lib/identity-verification-shared";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-client";
import { track } from "@/lib/analytics-client";
import { AGE_STATEMENT, MINIMUM_AGE } from "@/lib/age-policy";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { isPublishableName } from "@/lib/display-name";
import { cn } from "@/lib/utils";
import { REGISTRY_ROLE_DEFS, roleLabel } from "@/lib/roles";
import { FighterProfilePanel } from "@/components/fighters/fighter-profile-panel";
import { ConsentDialog, type ConsentTopic } from "@/components/legal/consent-dialog";

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
  const [registryAck, setRegistryAck] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [consentTopic, setConsentTopic] = useState<ConsentTopic | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSignup = mode === "signup";

  // Caught as they type, not on submit: a browser autofilling their email into
  // this field is exactly the case that shipped a live user's inbox onto their
  // public share card, and they need to see it before they press the button.
  const nameLooksLikeEmail = isSignup && name.trim().length > 0 && !isPublishableName(name);

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
    // Checked in JS as well as with `required`, because the browser check is the
    // only thing standing between an unread policy and a consent we would later
    // have to prove. The server enforces it too — see api/auth/signup.
    if (isSignup && !registryAck) {
      setError("Please confirm you understand how registry information is published.");
      return;
    }
    if (isSignup && !termsAccepted) {
      setError("Please read and accept the Terms of Service and Privacy Notice to continue.");
      return;
    }
    setSubmitting(true);
    try {
      if (isSignup) {
        await signup({ name, email, password, registryRole: role, ageConfirmed, termsAccepted });
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
          // Back rendered but did nothing on desktop. PageHero only calls
          // router.back() when useCanGoBack() is true, and this page is a
          // common COLD entry — a bookmark, a new tab, or the post-sign-in
          // landing, where there is no in-app history to go back to. Without a
          // fallback the button was either absent or a dead end. /profile is
          // the surface this page belongs under, so it is where Back goes.
          backFallback="/profile"
        />
        {/* The nudge, not a gate. Signup already finished — this is the first
            place a professional role is asked to prove who they are, and it is
            dismissible by simply not clicking it. Fans never see it.

            It is STATE-AWARE now. It used to key on the registry role alone, so
            somebody who had already been verified was still being told to go
            and verify — the one message guaranteed to make a completed process
            look broken. `professionalVerifiedAt` rides the session (see
            lib/auth SAFE_SELECT), so this costs no extra request.

            The PENDING case is deliberately not inferred here: whether a review
            is open is a second question the session does not answer, and
            /account/verification shows the full history the moment they arrive.
            Better a neutral doorway than a confident wrong state. */}
        {isProfessionalRole(user.registryRole) && (
          <div className="container-cr pt-6">
            {user.professionalVerifiedAt ? (
              <Link
                href="/account/verification"
                className="flex items-center gap-3 rounded-card border border-volt-500/30 bg-volt-500/10 p-4 transition-colors hover:border-volt-500/50"
              >
                <BadgeCheck className="size-5 shrink-0 text-volt-300" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-sm font-bold text-volt-200">
                    Verified {roleName}
                  </span>
                  <span className="block text-xs text-volt-200/70">
                    Confirmed{" "}
                    {new Date(user.professionalVerifiedAt).toLocaleDateString(undefined, {
                      day: "numeric", month: "long", year: "numeric",
                    })}
                    . Your verified badge is live.
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-volt-300" />
              </Link>
            ) : (
              <Link
                href="/account/verification"
                className="flex items-center gap-3 rounded-card border border-gold-500/30 bg-gold-500/10 p-4 transition-colors hover:border-gold-500/50"
              >
                <BadgeCheck className="size-5 shrink-0 text-gold-300" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-sm font-bold text-gold-200">
                    Verify your professional identity
                  </span>
                  <span className="block text-xs text-gold-200/70">
                    Get your verified badge and unlock {roleName} features. Takes a couple of minutes.
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-gold-300" />
              </Link>
            )}
          </div>
        )}
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
            {/* ── Identity & verification — ALWAYS here ──
                It used to exist only as a banner above, rendered solely when
                `isProfessionalRole(registryRole)` was true. So an account whose
                registry role is "fan" — which is the seed-admin default, and
                the commonest choice by a distance — had no route to this
                feature anywhere in the product except typing the URL. The
                feature was not missing; it was unreachable, which from the
                account page is the same thing.

                Always rendering it, and letting the COPY carry the state, also
                answers the fan case honestly: verification is for professional
                roles, and this says so and points at the profile editor rather
                than silently not existing. Selecting a role still grants
                nothing — see lib/promoter/verification. */}
            <Link
              href={isProfessionalRole(user.registryRole) ? "/account/verification" : "/profile"}
              className="card-surface flex flex-col justify-between gap-3 p-5 transition-colors hover:border-blood-500/40"
            >
              <BadgeCheck
                className={`size-6 ${
                  user.professionalVerifiedAt
                    ? "text-volt-300"
                    : isProfessionalRole(user.registryRole)
                      ? "text-gold-300"
                      : "text-blood-400"
                }`}
              />
              <div>
                <p className="font-display text-sm font-bold text-chalk">Identity &amp; verification</p>
                <p className="text-sm text-mist">
                  {user.professionalVerifiedAt
                    ? `Verified ${roleName}. Your badge is live.`
                    : isProfessionalRole(user.registryRole)
                      ? `Upload ID to verify your ${roleName} identity and see your review status.`
                      : "For professional roles. Set yours on your profile to apply."}
                </p>
              </div>
            </Link>
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
            {/* The feedback board's front door for members. Deliberately HERE
                rather than as a button on every public profile: it is an
                account action, not a piece of someone's identity, and a profile
                is somebody's record — not a suggestion box. */}
            <Link href="/feedback" className="card-surface flex flex-col justify-between gap-3 p-5 transition-colors hover:border-blood-500/40">
              <MessageSquarePlus className="size-6 text-blood-400" />
              <div>
                <p className="font-display text-sm font-bold text-chalk">Feedback</p>
                <p className="text-sm text-mist">Suggest ideas, report problems and vote on what gets built.</p>
              </div>
            </Link>
            <Link href="/events" className="card-surface flex flex-col justify-between gap-3 p-5 transition-colors hover:border-blood-500/40">
              <Bell className="size-6 text-blood-400" />
              <div><p className="font-display text-sm font-bold text-chalk">Make predictions</p><p className="text-sm text-mist">Call the next card before it closes.</p></div>
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
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-ink-700 bg-ink-950/50 p-1">
            {(["signup", "signin"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); setSuccess(null); }}
                className={cn(
                  // 4px = the track's 8px minus its 4px padding, so the two
                  // curves stay concentric instead of the inner one bulging.
                  "rounded-sm py-2.5 font-display text-xs font-bold uppercase tracking-wide transition-colors",
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
                  <span className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-fog">I&rsquo;m joining as…</span>
                    <span className="text-3xs text-fog">change anytime</span>
                  </span>
                  {/* One compact grid — every role visible without scrolling through
                      four stacked groups. Selected card lifts + shows a check. */}
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {REGISTRY_ROLE_DEFS.map((r) => {
                      const on = role === r.value;
                      return (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() => setRole(r.value)}
                          aria-pressed={on}
                          title={r.blurb}
                          className={cn(
                            "tap flex flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-all",
                            on
                              ? "border-blood-500/60 bg-blood-500/10 scale-[1.02]"
                              : "border-ink-700 bg-ink-950/40 hover:border-ink-600",
                          )}
                        >
                          <span className="flex w-full items-center justify-between gap-1">
                            <span className="font-display text-2xs font-bold leading-tight text-chalk">{r.label}</span>
                            {on && <Check className="size-3.5 shrink-0 text-blood-400" />}
                          </span>
                          <span className="line-clamp-1 text-4xs leading-tight text-fog">{r.blurb}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* DISPLAY NAME, and every attribute here is load-bearing.
                    This field was labelled "Username" with autoComplete="username",
                    which is the token browsers fill with the account identifier —
                    i.e. the EMAIL ADDRESS. So password managers helpfully typed a
                    live user's email into their public display name, and it was then
                    published on their share card, in their page title, in their meta
                    description and in their handle (/u/markbyerley6221gmail).
                    "nickname" is the correct token for a name shown to others, and
                    the label now says what the value actually is. */}
                <Field
                  icon={User}
                  label="Display name"
                  type="text"
                  placeholder="What should people call you?"
                  value={name}
                  onChange={setName}
                  required
                  autoComplete="nickname"
                  hint={
                    nameLooksLikeEmail
                      ? "That's an email address — pick a name other people will see."
                      : "Shown on your profile, the leaderboard and anything you share."
                  }
                  invalid={nameLooksLikeEmail}
                />
              </>
            )}

            <Field icon={Mail} label="Email" type="email" placeholder="you@example.com" value={email} onChange={setEmail} required autoComplete="email" />
            <Field icon={Lock} label="Password" type="password" placeholder={isSignup ? `At least ${MIN_PASSWORD_LENGTH} characters` : "Your password"} value={password} onChange={setPassword} required autoComplete={isSignup ? "new-password" : "current-password"} />

            {/* RECOVERY. The whole reset pipeline already existed — hashed
                single-use tokens, expiry, rate limits, no enumeration, session
                revocation — and nothing in the product linked to it. A recovery
                flow nobody can find is the same as not having one: the user's only
                remaining option is to email support, and at launch there is no
                support inbox. Sign-in only: during signup there is no account to
                recover yet. */}
            {!isSignup && (
              <div className="flex items-center justify-between gap-3 text-xs">
                <Link
                  href="/account/forgot"
                  className="font-semibold text-mist underline underline-offset-2 transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
                >
                  {t("Forgot password?")}
                </Link>
                <Link
                  href="/account/forgot?mode=username"
                  className="text-fog underline underline-offset-2 transition-colors hover:text-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
                >
                  {t("Forgot username?")}
                </Link>
              </div>
            )}

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
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-blood-500"
                    checked={registryAck}
                    onChange={(e) => setRegistryAck(e.target.checked)}
                    required
                  />
                  <span>
                    I agree that public, source-backed professional information may appear in the registry, and I will not
                    submit private personal data of others.
                  </span>
                </label>
                {/*
                  The consent that makes the notice binding. Both documents are
                  reachable WITHOUT leaving the form — a link that navigates away
                  loses everything typed, so in practice nobody reads it and the
                  tick means nothing. The dialog opens over the form instead.
                */}
                <label className="flex items-start gap-2 text-xs text-mist">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-blood-500"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    required
                  />
                  <span>
                    I have read and agree to the{" "}
                    <button
                      type="button"
                      onClick={() => setConsentTopic("terms")}
                      className="font-medium text-blood-400 underline underline-offset-2 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
                    >
                      Terms of Service
                    </button>{" "}
                    and the{" "}
                    <button
                      type="button"
                      onClick={() => setConsentTopic("privacy")}
                      className="font-medium text-blood-400 underline underline-offset-2 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
                    >
                      Privacy Notice
                    </button>
                    .
                  </span>
                </label>
              </>
            )}

            <Button type="submit" className="w-full" disabled={submitting || nameLooksLikeEmail}>
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

      {consentTopic && (
        <ConsentDialog topic={consentTopic} onClose={() => setConsentTopic(null)} />
      )}
    </>
  );
}

function Field({
  icon: Icon, label, type, placeholder, value, onChange, required, autoComplete, hint, invalid,
}: {
  icon: typeof Mail; label: string; type: string; placeholder: string;
  value: string; onChange: (v: string) => void; required?: boolean; autoComplete?: string;
  /** Guidance under the field. Always rendered when given, so it reads as help
   *  rather than appearing only once something is wrong. */
  hint?: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-fog">{label}</span>
      <div
        className={cn(
          "mt-1 flex items-center gap-2 rounded-lg border bg-ink-950/50 px-3",
          invalid ? "border-blood-500/70" : "border-ink-700 focus-within:border-blood-500/50",
        )}
      >
        <Icon className="size-4 text-fog" />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          // Announced to a screen reader, not just coloured — a red border is not
          // available to someone who cannot see it.
          aria-invalid={invalid || undefined}
          className="h-11 flex-1 bg-transparent text-sm text-chalk outline-none placeholder:text-fog"
        />
      </div>
      {hint && (
        <span className={cn("mt-1 block text-2xs", invalid ? "text-blood-300" : "text-fog")}>
          {hint}
        </span>
      )}
    </label>
  );
}
