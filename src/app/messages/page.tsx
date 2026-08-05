import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare, Users } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { EmptyState } from "@/components/ui/empty-state";
import { ForumAvatar } from "@/components/forums/user-identity";
import { getCurrentUser } from "@/lib/auth";
import { listConversations } from "@/lib/messages/repo";
import { timeAgo, cn } from "@/lib/utils";

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
        {conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-6" />}
            title="No conversations yet"
            body="Messages are private, one-to-one, and start from someone's profile. Find a predictor whose calls you rate, then open the conversation from their page."
            action={{ href: "/leaderboard", label: "Browse the leaderboard" }}
            secondary={
              <Link href="/following" className="text-sm font-semibold text-blood-300 hover:text-blood-200">
                See who you follow
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-ink-800 overflow-hidden rounded-card border border-ink-800 bg-ink-900/40">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/messages/${c.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-ink-800/60"
                >
                  <span className="relative shrink-0">
                    <ForumAvatar name={c.withUser.name} image={c.withUser.image} size="lg" />
                    {c.unread > 0 && (
                      <span
                        aria-hidden
                        className="absolute -right-0.5 -top-0.5 grid min-w-[1.15rem] place-items-center rounded-full border-2 border-ink-900 bg-blood-500 px-1 text-3xs font-bold tabular-nums text-white"
                      >
                        {c.unread > 9 ? "9+" : c.unread}
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate font-display text-sm", c.unread > 0 ? "font-black text-white" : "font-bold text-chalk")}>
                        {c.withUser.name}
                      </span>
                      <span className="shrink-0 text-3xs tabular-nums text-fog">
                        {timeAgo(c.lastMessageAt)}
                      </span>
                    </span>
                    <span className={cn("mt-0.5 block truncate text-xs", c.unread > 0 ? "font-semibold text-mist" : "text-fog")}>
                      {c.lastMessage
                        ? `${c.lastMessage.fromMe ? "You: " : ""}${c.lastMessage.body}`
                        : "No messages yet"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {conversations.length > 0 && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-fog">
            <Users className="size-3.5" /> Start a new conversation from someone&apos;s profile.
          </p>
        )}
      </div>
    </>
  );
}

export const dynamic = "force-dynamic";
