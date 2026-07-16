"use client";

import { useState } from "react";
import { LogOut, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";

/** Account settings — change display name, username, email and password, and
 *  sign out. Wired to /api/auth/account and /api/auth/password. */
export function ProfileSettings() {
  const { user, updateAccount, changePassword, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-4">
      <SettingCard
        title="Display name"
        fields={[{ key: "name", label: "Name", initial: user.name ?? "", placeholder: "Your name" }]}
        onSave={(v) => updateAccount({ name: v.name })}
      />
      <SettingCard
        title="Username"
        note="3–20 characters — letters, numbers or underscore."
        fields={[{ key: "username", label: "Username", initial: user.username ?? "", prefix: "@" }]}
        onSave={(v) => updateAccount({ username: v.username })}
      />
      <SettingCard
        title="Email"
        fields={[{ key: "email", label: "Email address", initial: user.email ?? "", type: "email" }]}
        onSave={(v) => updateAccount({ email: v.email })}
      />
      <SettingCard
        title="Password"
        note="Enter your current password, then a new one (min 8 characters)."
        clearOnSave
        fields={[
          { key: "current", label: "Current password", initial: "", type: "password", placeholder: "••••••••" },
          { key: "next", label: "New password", initial: "", type: "password", placeholder: "••••••••" },
        ]}
        onSave={(v) => changePassword(v.current, v.next)}
        cta="Change password"
      />

      <button
        onClick={() => logout()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-blood-500/40 bg-blood-500/10 py-3 font-display text-sm font-bold uppercase tracking-wide text-blood-300 transition-colors hover:bg-blood-500/20"
      >
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );
}

type Field = { key: string; label: string; initial: string; type?: string; placeholder?: string; prefix?: string };

function SettingCard({
  title, note, fields, onSave, cta = "Save", clearOnSave,
}: {
  title: string; note?: string; fields: Field[];
  onSave: (values: Record<string, string>) => Promise<void>; cta?: string; clearOnSave?: boolean;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.initial])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = fields.some((f) => (vals[f.key] ?? "") !== f.initial) || clearOnSave;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await onSave(vals);
      setMsg({ ok: true, text: "Saved." });
      if (clearOnSave) setVals(Object.fromEntries(fields.map((f) => [f.key, ""])));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
      <div className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{title}</div>
      {note && <p className="mt-1 text-[0.72rem] text-fog">{note}</p>}
      <div className="mt-3 space-y-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="sr-only">{f.label}</span>
            <div className="flex items-center rounded-xl border border-ink-700 bg-ink-850 focus-within:border-blood-500/60">
              {f.prefix && <span className="pl-3 text-sm text-fog">{f.prefix}</span>}
              <input
                type={f.type ?? "text"}
                value={vals[f.key] ?? ""}
                placeholder={f.placeholder ?? f.label}
                autoComplete={f.type === "password" ? "new-password" : "off"}
                onChange={(e) => { setVals((s) => ({ ...s, [f.key]: e.target.value })); setMsg(null); }}
                className="w-full bg-transparent px-3 py-2.5 text-sm text-chalk outline-none placeholder:text-fog"
              />
            </div>
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
            busy || !dirty ? "bg-ink-800 text-fog" : "bg-blood-500 text-white hover:bg-blood-400",
          )}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {cta}
        </button>
        {msg && <span className={cn("text-xs font-medium", msg.ok ? "text-up" : "text-blood-300")}>{msg.text}</span>}
      </div>
    </div>
  );
}
