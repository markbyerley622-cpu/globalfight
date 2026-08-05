import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Image from "next/image";
import { UserPlus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { publicDisplayName } from "@/lib/display-name";
import { SITE } from "@/lib/config";
import { ShareMenu, CopyLinkButton } from "@/components/share-menu";

export const metadata: Metadata = {
  title: "Invite friends",
  description: "Bring people onto the card. Share your invite link and see who can actually read a fight.",
  robots: { index: false, follow: false },
};

/**
 * Your invite link, and a real preview of what other people will see.
 *
 * The preview is the point. Sharing a link is an act of faith otherwise — you find
 * out what the card looks like only after you have sent it to a group chat. This
 * renders the ACTUAL og:image, so what is on screen is byte-for-byte what WhatsApp
 * will show.
 */
export default async function InviteHubPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/account?next=/invite");

  // A user with no handle has nothing to invite WITH — the invite URL is built from
  // it. Sending them to their profile to set one is better than a dead page.
  if (!user.username) redirect("/profile");

  const who = publicDisplayName(user);
  const path = `/invite/${user.username}`;
  const shareTitle = `${who} invited you to Combat Reviews — call the fights, build a record.`;

  return (
    <div className="container-cr max-w-2xl py-10 md:py-14">
      <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.22em] text-fog">
        <UserPlus aria-hidden className="size-3.5" /> Invite
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold uppercase text-chalk md:text-4xl">
        Bring people onto the card
      </h1>
      <p className="mt-2 text-sm text-mist">
        Everyone you invite gets your record on the invitation. Find out who can actually read a fight.
      </p>

      {/* THE PREVIEW — the same og:image the link will unfurl to. */}
      <div className="mt-7 overflow-hidden card-surface">
        <Image
          src={`${path}/opengraph-image`}
          alt={`Your invite card: ${who} wants you on the card`}
          width={1200}
          height={630}
          // The OG route is dynamic per user, so Next's optimiser has nothing to
          // cache against and would just add a hop.
          unoptimized
          className="h-auto w-full"
          priority
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 px-4 py-3">
          <p className="text-xs text-fog">This is exactly what WhatsApp, iMessage and email will show.</p>
          <div className="flex items-center gap-2">
            <CopyLinkButton path={path} />
            <ShareMenu path={path} title={shareTitle} label="Share invite" />
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-fog">
        Your link:{" "}
        {/* Derived from SITE.url, never hardcoded: this renders on localhost, on a
            preview deploy and in production, and a link that claims the wrong host
            is worse than no link at all. */}
        <Link href={path} className="text-mist underline underline-offset-2 hover:text-chalk">
          {`${SITE.url.replace(/^https?:\/\//, "")}${path}`}
        </Link>
      </p>
    </div>
  );
}
