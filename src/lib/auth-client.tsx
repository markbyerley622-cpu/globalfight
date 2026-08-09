"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  image: string | null;
  bannerUrl: string | null;
  registryRole: string;
  role: string;
  reputation: number;
  /**
   * When staff confirmed this person's professional identity, or null.
   *
   * A STRING here, not a Date: this crosses the wire as JSON, so whatever the
   * server typed it as arrives parsed as an ISO string. Typing it as Date would
   * compile and then hand every caller an object with no `getTime`.
   */
  professionalVerifiedAt: string | null;
  /** Owns a promotion or has applied to. Decides whether the menu OFFERS
   *  "Host events" — never whether anything is permitted. See SessionUser. */
  isPromoter: boolean;
}

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  signup: (input: SignupInput) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateAccount: (fields: { name?: string; username?: string; email?: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

interface SignupInput {
  name?: string;
  email: string;
  password: string;
  registryRole: string;
  ageConfirmed: boolean;
  /** Acceptance of the Terms + Privacy Notice. The route rejects anything else. */
  termsAccepted: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Something went wrong. Please try again.");
  return data;
}

export function AuthProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  /** When the root layout resolves the session server-side and passes it in
   *  (even as null), the first client paint already knows the user — no
   *  /api/auth/me round-trip and no loading→resolved flash. When omitted
   *  (undefined), we fall back to the on-mount fetch so behaviour is unchanged.
   *  refresh() re-syncs on demand after a mutation regardless. */
  initialUser?: AuthUser | null;
}) {
  const seeded = initialUser !== undefined;
  const [user, setUser] = useState<AuthUser | null>(initialUser ?? null);
  const [loading, setLoading] = useState(!seeded);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch on mount when the server did NOT seed us (unchanged legacy path).
  useEffect(() => {
    if (!seeded) refresh();
  }, [seeded, refresh]);

  const signup = useCallback(async (input: SignupInput) => {
    const data = await postJson("/api/auth/signup", input);
    setUser(data.user);
    // Straight into the first run. A brand-new account with no follows lands on
    // an empty product otherwise, which is the single worst first session we can
    // give someone. A full navigation (not router.push) so the new session
    // cookie is picked up by the server render.
    if (typeof window !== "undefined") window.location.href = "/welcome";
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await postJson("/api/auth/login", { email, password });
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const updateAccount = useCallback(async (fields: { name?: string; username?: string; email?: string }) => {
    const data = await postJson("/api/auth/account", fields);
    setUser(data.user);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await postJson("/api/auth/password", { currentPassword, newPassword });
  }, []);

  // Memoized so useAuth() consumers don't re-render on every provider render —
  // the callbacks are already useCallback-stable, so this changes only when the
  // user or loading actually changes.
  const value = useMemo<AuthValue>(
    () => ({ user, loading, signup, login, logout, refresh, updateAccount, changePassword }),
    [user, loading, signup, login, logout, refresh, updateAccount, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

// ════════════════════════════════════════════════════════════════════════════
//  The three auth states, as one decision.
//
//  `useAuth()` returns { user, loading }, and EVERY call site that guarded a
//  write wrote `if (!user) { location.href = "/account" }` — conflating two
//  states that are not the same thing:
//
//      loading === true,  user === null   →  we don't know yet
//      loading === false, user === null   →  genuinely signed out
//
//  During the /api/auth/me round-trip the first state looks exactly like the
//  second, so tapping a control in that window HARD-REDIRECTED a signed-in user
//  to /account — losing the page, the scroll and any optimistic state. On the
//  prediction pill that is the single most-tapped control in the product.
//
//  Six components had the bug independently, which is the signal that the
//  answer is not six fixes: the gate belongs next to the state it reads, so a
//  seventh component cannot reintroduce it.
//
//  Deliberately NOT solved with a delay, a timeout or a retry. The provider
//  already knows whether it has resolved; the call sites simply never asked.
// ════════════════════════════════════════════════════════════════════════════

export type AuthGateResult = "PENDING" | "REDIRECTED" | "OK";

export interface AuthGate {
  /** Auth has resolved — safe to treat `signedIn` as the truth. */
  ready: boolean;
  /** Resolved AND has a user. False while pending, so never use it to redirect. */
  signedIn: boolean;
  /**
   * Call at the top of a write handler:
   *
   *   if (gate.requireSignIn() !== "OK") return;
   *
   * PENDING    — still resolving. The caller bails and the user simply taps
   *              again a moment later. No redirect, nothing destroyed.
   * REDIRECTED — genuinely signed out; the sign-in navigation has started.
   * OK         — proceed.
   */
  requireSignIn: (next?: string) => AuthGateResult;
}

export function useAuthGate(): AuthGate {
  const { user, loading } = useAuth();

  const requireSignIn = useCallback(
    (next?: string): AuthGateResult => {
      if (loading) return "PENDING";
      if (!user) {
        // `next` returns them to what they were doing instead of dumping them
        // on the account page with no way back.
        const target = next ?? (typeof window !== "undefined" ? window.location.pathname : "");
        window.location.href = target ? `/account?next=${encodeURIComponent(target)}` : "/account";
        return "REDIRECTED";
      }
      return "OK";
    },
    [user, loading],
  );

  // MEMOISED. Returning a fresh object literal made every useCallback that
  // depends on the gate change identity on EVERY render, which in turn made any
  // effect keyed on that callback re-run continuously — the replay effect could
  // never settle long enough to fire. A hook that guards a write must be stable
  // or it destabilises everything downstream of it.
  return useMemo(
    () => ({ ready: !loading, signedIn: !loading && Boolean(user), requireSignIn }),
    [loading, user, requireSignIn],
  );
}
