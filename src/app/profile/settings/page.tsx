import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Bell, Dumbbell, Pencil, Settings as SettingsIcon, UserPlus, ChevronRight } from "lucide-react";
import { ProfileSettings } from "@/components/profile/profile-settings";
import { DeleteAccount } from "@/components/account/delete-account";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Combat Reviews account — display name, username, email, password and notifications.",
  alternates: { canonical: "/profile/settings" },
  // Nobody should reach an account-management screen from a search result.
  robots: { index: false, follow: false },
};

/**
 * ACCOUNT MANAGEMENT, on its own screen.
 *
 * ── Why this route exists ──────────────────────────────────────────────────
 * /profile was two products stacked on one page. The top half is a public
 * identity — avatar, handle, reputation, accuracy, streak, followers — and the
 * bottom half was a settings form: display name, username, email address,
 * current password, new password, sign out.
 *
 * Those are opposite mental models. A visitor is there to look at a person; the
 * owner is occasionally there to administer an account. Interleaving them meant
 * the most-visited profile in the app opened on password fields, and made the
 * whole surface read as a settings screen that happened to show a reputation
 * number — which is precisely the complaint.
 *
 * So the split is by INTENT, not by component: everything that changes who you
 * ARE stays on /profile, and everything that changes how the ACCOUNT is
 * administered lives here. ProfileSettings itself is unchanged and unmoved —
 * this page just gives it somewhere to be that is not in front of the identity.
 */
export default function ProfileSettingsPage() {
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
