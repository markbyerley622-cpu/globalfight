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
