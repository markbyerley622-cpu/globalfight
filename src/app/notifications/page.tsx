import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Settings } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { NotificationCentre } from "@/components/notifications/notification-centre";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Everything that happened to the fighters, cards, gyms and people you follow.",
  // Someone else's notification list is not a page for a crawler, and the route is
  // signed-in-only anyway.
  robots: { index: false, follow: false },
};

/**
 * The notification centre.
 *
 * The bell's sheet is for triage on the way past; this is the page you open when
 * you actually want to go through them — the same rows, the same grouping and the
 * same transport, with room to read and paginate.
 */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  // Server-side, before any of it renders: a signed-out reader on this URL wants
  // to sign in, not to be told the list is empty.
  if (!user) redirect("/account?next=/notifications");

  return (
    <div className="container-cr max-w-2xl py-8 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.2em] text-fog">
            <Bell aria-hidden className="size-3.5" /> Your feed
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold uppercase text-chalk md:text-4xl">
            Notifications
          </h1>
        </div>
        <Link
          href="/profile#notifications"
          className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-mist transition-colors hover:border-ink-600 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
        >
          <Settings aria-hidden className="size-3.5" /> Settings
        </Link>
      </div>

      <NotificationCentre />
    </div>
  );
}
