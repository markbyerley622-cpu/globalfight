import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Bell, Dumbbell, Pencil, Settings as SettingsIcon, UserPlus, ChevronRight } from "lucide-react";
import { ProfileSettings } from "@/components/profile/profile-settings";
import { DeleteAccount } from "@/components/account/delete-account";
import { BlockedList } from "@/components/account/blocked-list";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Combat Reviews account — display name, username, email, password and notifications.",
  alternates: { canonical: "/settings" },
  // Nobody should reach an account-management screen from a search result.
  robots: { index: false, follow: false },
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  SETTINGS — one address, and it is this one.
 *
 *  ── The bug this route fixes ────────────────────────────────────────────
 *  The account menu's "Settings" item pointed at `/account`. That is the
 *  SIGN-UP page: signed out it is the join form, and signed in it is a
 *  "Members" dashboard carrying the fighter-profile publishing form. Pressing
 *  Settings therefore landed on a page offering to publish a fighter profile,
 *  with no display name, email or password field anywhere on it.
 *
 *  The real settings screen existed the whole time at /profile/settings, and
 *  nothing in the top-level navigation pointed at it — it was reachable only
 *  from a row inside /profile. So the app had two account surfaces, the wrong
 *  one was in the menu, and the right one was two clicks deep.
 *
 *  ── Why /settings and not /profile/settings ─────────────────────────────
 *  Settings is not a subsection of a profile. A profile is a public identity
 *  (/u/<handle> is the shareable one); settings is private account
 *  administration, and nesting it under /profile implied a relationship the
 *  product does not have — which is part of how it ended up hidden. A
 *  top-level noun is also what a person types and what a menu item should
 *  point at.
 *
 *  /profile/settings still resolves: it is a permanent redirect here
 *  (next.config.ts), so bookmarks, the Terms page and the Community Guidelines
 *  links all keep working.
 * ════════════════════════════════════════════════════════════════════════════
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:max-w-3xl">
      <Link
        href="/profile"
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fog transition-colors hover:text-chalk"
      >
        <ArrowLeft aria-hidden className="size-3.5" /> Profile
      </Link>

      <h1 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold uppercase tracking-tight text-chalk">
        <SettingsIcon aria-hidden className="size-5 text-fog" /> Settings
      </h1>
      <p className="mt-1 text-sm text-fog">
        Your account. Nothing here is visible on your public profile.
      </p>

      {/* The management destinations that used to sit as rows on /profile,
          between the reputation block and the password form. They are all
          administration, so they belong on the administration screen. */}
      <div className="mt-6 overflow-hidden card-surface">
        <Row href="/profile/edit" icon={Pencil} name="Edit profile" desc="Role, disciplines, bio, links, map presence" />
        <Row href="/notifications" icon={Bell} name="Notifications" desc="Results, cards and fight-week news" />
        <Row href="/gyms" icon={Dumbbell} name="Gyms" desc="Where you train, and who trains there" />
        {/* Invites keep a home — they were removed from the profile itself,
            where a growth prompt sat between a reader and their own record. */}
        <Row href="/invite" icon={UserPlus} name="Invite friends" desc="Your link, your card, who's joined" />
      </div>

      <div className="mt-6">
        <ProfileSettings />
      </div>

      {/* The only place a block can be undone — see the component. Renders
          nothing at all when nobody is blocked. */}
      <BlockedList />

      {/* Erasure lives at the bottom of the only screen that administers the
          account, behind its own disclosure. The API has existed for a while;
          until now nothing linked to it, which made a GDPR Art. 17 route a
          right the user had no way to exercise. */}
      <DeleteAccount />
    </div>
  );
}

function Row({ href, icon: Icon, name, desc }: { href: string; icon: typeof Bell; name: string; desc: string }) {
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
