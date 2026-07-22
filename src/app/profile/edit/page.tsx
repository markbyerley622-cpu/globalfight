import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { MyClaims } from "@/components/profile/my-claims";
import { NotificationSettings } from "@/components/profile/notification-settings";

export const metadata: Metadata = {
  title: "Edit profile",
  description: "Your Combat Reviews identity — role, disciplines, gym, links and map presence.",
  robots: { index: false },
};

/**
 * The control centre. Everything a user can change about themselves is on this
 * one screen, saving through one endpoint — identity used to be split between
 * an avatar uploader, a separate map-settings panel, and nothing at all for
 * name, bio, role, links or disciplines.
 */
export default function EditProfilePage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-5 lg:max-w-3xl">
      <Link
        href="/profile"
        className="mb-3 inline-flex items-center gap-1 text-[0.72rem] font-semibold uppercase tracking-wide text-fog hover:text-chalk"
      >
        <ChevronLeft className="size-3.5" /> Profile
      </Link>
      <h1 className="font-display text-2xl font-black uppercase tracking-tight text-chalk">Edit profile</h1>
      <p className="mt-1 text-sm text-fog">Changes save as you go.</p>

      <div className="mt-5">
        <ProfileEditor />
      </div>

      <div className="mt-4">
        <NotificationSettings />
      </div>

      <div className="mt-4">
        <MyClaims />
      </div>
    </div>
  );
}
