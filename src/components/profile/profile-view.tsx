"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Star, Bell, Settings, ChevronRight, Loader2, Swords, Camera } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-client";
import { ProfileSettings } from "./profile-settings";

const initials = (u: { name: string | null; username: string | null }) =>
  (u.name ?? u.username ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** The user's profile: identity (with editable banner + avatar) + account
 *  shortcuts + settings. */
export function ProfileView() {
  const t = useT();
  const { user, loading, refresh } = useAuth();
  const [uploading, setUploading] = useState<null | "avatar" | "banner">(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  async function upload(kind: "avatar" | "banner", file: File) {
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch("/api/profile/image", { method: "POST", body: fd });
      if (res.ok) await refresh();
    } finally {
      setUploading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-mist">
        <Loader2 className="size-5 animate-spin" /> {t("Loading…")}
      </div>
    );
  }

  // ── Signed-out gate ──
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 lg:max-w-3xl">
        <div className="overflow-hidden rounded-3xl border border-ink-800 bg-[radial-gradient(600px_260px_at_50%_0%,rgba(225,29,42,0.28),transparent_62%),linear-gradient(160deg,#12060a,#0a0d12)] p-8 text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-3xl border border-ink-700 bg-ink-900"><Swords className="size-8 text-blood-400" /></div>
          <h1 className="mt-5 font-display text-2xl font-bold uppercase tracking-tight text-chalk">Build your Combat profile</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-mist">
            Follow fighters, predict fights and claim your fighter page. Sign in to start your profile.
          </p>
          <Link
            href="/account"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-blood-400 to-blood-700 px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-[0_8px_24px_-6px_rgba(225,29,42,0.7)]"
          >
            Sign in / Create account
          </Link>
        </div>
      </div>
    );
  }

  const role = (user.registryRole || "fan").replace(/_/g, " ");

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8 lg:max-w-3xl">
      {/* Cover / banner — editable */}
      <div className="relative -mx-4 h-32 overflow-hidden border-b border-ink-800">
        {user.bannerUrl ? (
          <Image src={user.bannerUrl} alt="" fill className="object-cover" unoptimized />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(400px_200px_at_15%_0%,rgba(225,29,42,0.4),transparent_60%),radial-gradient(400px_200px_at_100%_100%,rgba(56,189,248,0.32),transparent_60%),linear-gradient(135deg,#141923,#0a0d12)]" />
        )}
        <button
          onClick={() => bannerRef.current?.click()}
          disabled={uploading !== null}
          aria-label="Change banner"
          className="tap absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-ink-600/80 bg-ink-950/70 px-2.5 py-1.5 text-[0.68rem] font-semibold text-chalk backdrop-blur hover:bg-ink-900/80"
        >
          {uploading === "banner" ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
          Edit banner
        </button>
        <input ref={bannerRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload("banner", f); }} />
      </div>

      {/* Avatar — editable */}
      <div className="relative -mt-10 w-fit">
        {user.image ? (
          <Image src={user.image} alt="" width={84} height={84} className="size-[84px] rounded-3xl border-[3px] border-blood-500 bg-ink-950 object-cover shadow-[0_0_16px_-3px_rgba(225,29,42,0.55)]" unoptimized />
        ) : (
          <span className="grid size-[84px] place-items-center rounded-3xl border-[3px] border-blood-500 bg-ink-950 font-display text-3xl font-bold text-blood-500 shadow-[0_0_16px_-3px_rgba(225,29,42,0.55)]">
            {initials(user)}
          </span>
        )}
        <button
          onClick={() => avatarRef.current?.click()}
          disabled={uploading !== null}
          aria-label="Change profile photo"
          className="tap absolute -bottom-1.5 -right-1.5 grid size-8 place-items-center rounded-full border-2 border-ink-950 bg-blood-500 text-white shadow-md hover:bg-blood-400"
        >
          {uploading === "avatar" ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-4" />}
        </button>
        <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload("avatar", f); }} />
      </div>

      {/* Name + role */}
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-chalk">
        {user.name ?? user.username ?? "Your profile"}
      </h1>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-blood-500/25 bg-blood-500/12 px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide text-blood-300">{role}</span>
        {user.username && <span className="text-[0.8rem] text-fog">@{user.username}</span>}
        <span className="text-[0.8rem] text-fog">· Combat Register member</span>
      </div>

      {/* Account shortcuts */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
        <Row href="/predictions" icon={Star} name="Predictions" desc="Your picks and results" />
        <Row href="/account" icon={Bell} name="Notifications" desc="Fight-week reminders & breaking news" />
      </div>

      {/* Settings */}
      <div className="mt-5 flex items-center gap-2 px-1">
        <Settings className="size-4 text-fog" />
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Settings</h3>
      </div>
      <div className="mt-3">
        <ProfileSettings />
      </div>
    </div>
  );
}

function Row({ href, icon: Icon, name, desc }: { href: string; icon: typeof Star; name: string; desc: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 border-b border-ink-800 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-ink-800">
      <span className="grid size-9 place-items-center rounded-xl border border-ink-700 bg-ink-800 text-mist"><Icon className="size-[1.05rem]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-chalk">{name}</span>
        <span className="block truncate text-[0.72rem] text-fog">{desc}</span>
      </span>
      <ChevronRight className="size-4 text-fog" />
    </Link>
  );
}
