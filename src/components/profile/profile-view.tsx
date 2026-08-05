"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Star, Bell, Settings, ChevronRight, Loader2, Swords, Camera, Dumbbell, Pencil, Flame, UserPlus } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-client";
import { ProfileSettings } from "./profile-settings";
import { ProfileStats } from "./profile-stats";
import { EditProfileLink } from "./profile-editor";
import { ShareMenu, CopyLinkButton } from "@/components/share-menu";

const initials = (u: { name: string | null; username: string | null }) =>
  (u.name ?? u.username ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** The user's profile: identity (with editable banner + avatar) + account
 *  shortcuts + settings. */
export function ProfileView({
  followCounts = null,
  username: serverUsername = null,
}: {
  /** Resolved on the server in app/profile/page.tsx. Null when signed out. */
  followCounts?: { followers: number; following: number } | null;
  /** The signed-in handle as the SERVER saw it, used only to build the links. */
  username?: string | null;
} = {}) {
  const t = useT();
  const { user, loading, refresh } = useAuth();
  const [uploading, setUploading] = useState<null | "avatar" | "banner">(null);
  // A failed upload used to be COMPLETELY silent: the handler was
  // `if (res.ok) await refresh()` with no else branch, so a 503 (uploads gated), a
  // 413 (too large) or a 415 (corrupt file) all looked identical to the user — the
  // spinner stopped and the picture simply did not change. There was no way to tell
  // "this is switched off" from "your file is too big" from "it worked but the image
  // is cached", which is most of why this read as permanently broken.
  const [uploadError, setUploadError] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  async function upload(kind: "avatar" | "banner", file: File) {
    setUploading(kind);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch("/api/profile/image", { method: "POST", body: fd });
      if (res.ok) {
        await refresh();
        return;
      }
      // Every failure path on this route returns { error }, so show the server's own
      // sentence rather than inventing a vaguer one.
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setUploadError(data?.error ?? "That upload didn't go through. Please try again.");
    } catch {
      setUploadError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setUploading(null);
    }
  }

  if (loading) {
    // The loading state must occupy roughly what replaces it.
    //
    // This was a single centred row about 216px tall; the resolved profile is
    // ~400px+. The swap moved everything below it and measured CLS 0.694 on
    // /profile against ≤0.006 on every other page — five times Google's "poor"
    // threshold, and the worst number in the app by two orders of magnitude.
    // Reserving the height costs nothing and removes the whole shift.
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pb-8 lg:max-w-3xl" aria-busy="true">
        <div className="min-h-[26rem] rounded-card border border-ink-800 bg-ink-900/40">
          <div className="flex items-center justify-center gap-2 py-24 text-mist">
            <Loader2 className="size-5 animate-spin" /> {t("Loading…")}
          </div>
        </div>
      </div>
    );
  }

  // ── Signed-out gate ──
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 lg:max-w-3xl">
        <div className="overflow-hidden rounded-card border border-ink-800 bg-[radial-gradient(600px_260px_at_50%_0%,rgba(225,29,42,0.28),transparent_62%),linear-gradient(160deg,#12060a,var(--color-ink-900))] p-8 text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-squircle border border-ink-700 bg-ink-900"><Swords className="size-8 text-blood-400" /></div>
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
          <div className="absolute inset-0 bg-[radial-gradient(400px_200px_at_15%_0%,rgba(225,29,42,0.4),transparent_60%),radial-gradient(400px_200px_at_100%_100%,rgba(56,189,248,0.32),transparent_60%),linear-gradient(135deg,var(--color-ink-800),var(--color-ink-900))]" />
        )}
        <button
          onClick={() => bannerRef.current?.click()}
          disabled={uploading !== null}
          aria-label="Change banner"
          className="tap absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-ink-600/80 bg-ink-950/70 px-2.5 py-1.5 text-2xs font-semibold text-chalk backdrop-blur hover:bg-ink-900/80"
        >
          {uploading === "banner" ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
          Edit banner
        </button>
        <input ref={bannerRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload("banner", f); }} />
      </div>

      {/* Avatar — editable */}
      <div className="relative -mt-10 w-fit">
        {user.image ? (
          <Image src={user.image} alt="" width={84} height={84} className="size-[84px] rounded-squircle border-[3px] border-blood-500 bg-ink-950 object-cover shadow-[0_0_16px_-3px_rgba(225,29,42,0.55)]" unoptimized />
        ) : (
          <span className="grid size-[84px] place-items-center rounded-squircle border-[3px] border-blood-500 bg-ink-950 font-display text-3xl font-bold text-blood-500 shadow-[0_0_16px_-3px_rgba(225,29,42,0.55)]">
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

      {/* Why the last upload failed. `role="alert"` so it is announced rather than
          only seen — the control that triggered it is an icon button, and a silent
          failure next to a camera icon is indistinguishable from a no-op. */}
      {uploadError && (
        <p role="alert" className="mt-3 rounded-lg border border-blood-500/40 bg-blood-500/10 px-3 py-2 text-xs text-blood-200">
          {uploadError}
        </p>
      )}

      {/* Name + role */}
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-chalk">
        {user.name ?? user.username ?? "Your profile"}
      </h1>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-blood-500/25 bg-blood-500/12 px-2.5 py-1 text-2xs font-bold uppercase tracking-wide text-blood-300">{role}</span>
        {user.username && <span className="text-xs text-fog">@{user.username}</span>}
        <EditProfileLink />
      </div>

      {/* Followers / following. Shown even at zero: "0 followers" is a real
          answer, and hiding the row until someone arrives means the feature is
          invisible to exactly the people who have not been found yet. */}
      {followCounts && (user.username ?? serverUsername) && (
        <div className="mt-3 flex items-center gap-5">
          <FollowStat
            href={`/u/${user.username ?? serverUsername}/followers`}
            value={followCounts.followers}
            label={followCounts.followers === 1 ? "follower" : "followers"}
          />
          <FollowStat
            href={`/u/${user.username ?? serverUsername}/following`}
            value={followCounts.following}
            label="following"
          />
        </div>
      )}

      {/* Today — the daily surface. Given its own card above the all-time stats
          because it is the only thing on this screen that changes on a day
          with no fights, and burying it in the shortcut list made it look
          like a settings row. */}
      <Link
        href="/today"
        className="mt-5 flex items-center gap-3 rounded-card border border-blood-500/30 bg-[radial-gradient(320px_120px_at_0%_0%,rgba(225,29,42,0.18),transparent_70%),linear-gradient(150deg,var(--color-ink-800),var(--color-ink-900))] p-4 transition-colors hover:border-blood-500/50"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-blood-500/40 bg-blood-500/12 text-blood-400">
          <Flame className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-bold uppercase tracking-wide text-chalk">Today</span>
          <span className="block truncate text-2xs text-fog">Your streak, what moved, and what to do next</span>
        </span>
        <ChevronRight className="size-4 text-fog" />
      </Link>

      {/* Identity: reputation, accuracy, streak, prediction history, activity */}
      <ProfileStats />

      {/* INVITES. This lived only at /invite, which nothing linked to — a growth
          feature reachable exclusively by typing the URL. It belongs in the account
          area, and the two actions people actually want (copy, share) are here
          rather than one navigation away. The full centre — preview card, stats —
          is still one tap on the heading, so this is an entry point and not a
          second implementation of it. */}
      {user.username && <InviteCard username={user.username} name={user.name ?? user.username} />}

      {/* Account shortcuts */}
      <div className="mt-6 overflow-hidden card-surface">
        <Row href="/predictions/mine" icon={Star} name="My Predictions" desc="Your picks and how they landed" />
        <Row href="/invite" icon={UserPlus} name="Invite friends" desc="Your link, your card, who's joined" />
        {/* Was pointing at /profile/edit — the notification PREFERENCES — while the
            notification centre itself had no entry point in the profile at all. */}
        <Row href="/notifications" icon={Bell} name="Notifications" desc="Results, cards and fight-week news" />
        <Row href="/profile/edit" icon={Pencil} name="Edit profile" desc="Role, disciplines, links, map presence" />
        <Row href="/gyms" icon={Dumbbell} name="Gyms" desc="Where you train, and who trains there" />
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

/**
 * The invite entry point, with the two actions that get used.
 *
 * Deliberately NOT a copy of the /invite centre: no preview image (it is a 1200x630
 * fetch that would compete with the profile's own content) and no stats. It gives
 * the link, copy, share, and a way through to the rest.
 */
/** One tappable count. Mirrors the pair on /u/[username] so the two profiles
 *  read identically — the same fact should not have two presentations. */
function FollowStat({ href, value, label }: { href: string; value: number; label: string }) {
  return (
    <Link
      href={href}
      className="group flex items-baseline gap-1.5 rounded-lg px-1 py-0.5 transition-colors hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
    >
      <span className="font-display text-base font-bold text-chalk">{value.toLocaleString()}</span>
      <span className="text-xs text-fog group-hover:text-mist">{label}</span>
    </Link>
  );
}

function InviteCard({ username, name }: { username: string; name: string }) {
  const path = `/invite/${username}`;
  return (
    <section className="mt-6 rounded-card border border-blood-500/25 bg-gradient-to-b from-blood-500/10 to-transparent p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-chalk">
            <UserPlus aria-hidden className="size-4 text-blood-400" /> Invite friends
          </h3>
          <p className="mt-1 text-2xs leading-relaxed text-fog">
            Your record travels with the invitation. Find out who can actually read a fight.
          </p>
        </div>
        <Link
          href="/invite"
          className="shrink-0 text-2xs font-semibold uppercase tracking-wide text-mist underline underline-offset-2 transition-colors hover:text-chalk"
        >
          Open
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CopyLinkButton path={path} />
        <ShareMenu path={path} title={`${name} invited you to Combat Reviews`} label="Share invite" />
      </div>
    </section>
  );
}

function Row({ href, icon: Icon, name, desc }: { href: string; icon: typeof Star; name: string; desc: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 border-b border-ink-800 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-ink-800">
      <span className="grid size-9 place-items-center rounded-lg border border-ink-700 bg-ink-800 text-mist"><Icon className="size-[1.05rem]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-chalk">{name}</span>
        <span className="block truncate text-2xs text-fog">{desc}</span>
      </span>
      <ChevronRight className="size-4 text-fog" />
    </Link>
  );
}
