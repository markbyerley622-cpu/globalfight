import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { EmptyState } from "@/components/ui/empty-state";
import { NewMessageButton } from "@/components/messages/new-message-button";
import { InboxList } from "@/components/messages/inbox-list";
import { getCurrentUser } from "@/lib/auth";
import { listConversations } from "@/lib/messages/repo";

export const metadata: Metadata = {
  title: "Messages",
  description: "Your private conversations on Combat Reviews.",
  // A private inbox must never be indexed, whatever the host.
  robots: { index: false, follow: false },
};

export default async function MessagesPage() {
  const user = await getCurrentUser();
  // returnTo, so signing in lands back here rather than on a generic account
  // page — the account-gate rule the audit raised for every other surface.
  if (!user) redirect(`/account?returnTo=${encodeURIComponent("/messages")}`);

  const conversations = await listConversations(user.id);

  return (
    <>
      <PageHero
        eyebrow="Private"
        title="Messages"
        description="One-to-one conversations. Only you and the other person can read them."
      />

      <div className="container-cr py-6">
        {/* The compose control, on the surface that is FOR composing. It sits
            above the list in both states — an inbox with fifty threads still
            needs a way to open the fifty-first, and hunting for it inside a
            profile page is not one. */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs text-fog">
            {conversations.length > 0
              ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`
              : "Private, one-to-one."}
          </p>
          <NewMessageButton />
        </div>

        {conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-6" />}
            title="No conversations yet"
            body="Messages here are private to the two of you. Search for anyone by name or @handle to start one — or find a predictor whose calls you rate."
            action={{ href: "/leaderboard", label: "Browse the leaderboard" }}
            secondary={
              <Link href="/following" className="text-sm font-semibold text-blood-300 hover:text-blood-200">
                See who you follow
              </Link>
            }
          />
        ) : (
          // The first list is still SERVER-rendered and handed straight in — no
          // spinner, no layout shift, and it works with JavaScript off. The
          // client takes over from there to keep presence and typing live.
          <InboxList initial={conversations} />
        )}

      </div>
    </>
  );
}

export const dynamic = "force-dynamic";
