"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { refresh(); }, [refresh]);

  const signup = useCallback(async (input: SignupInput) => {
    const data = await postJson("/api/auth/signup", input);
    setUser(data.user);
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

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout, refresh, updateAccount, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
