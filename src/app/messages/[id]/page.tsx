import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MessageThread } from "@/components/messages/message-thread";
import { getCurrentUser } from "@/lib/auth";
import { getConversation, markRead } from "@/lib/messages/repo";

export const metadata: Metadata = {
  title: "Message",
  robots: { index: false, follow: false },
};

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/account?returnTo=${encodeURIComponent(`/messages/${id}`)}`);

  // getConversation returns null for BOTH a missing thread and one the viewer
  // is not in, so a non-member gets an ordinary 404 and cannot use this route
  // to discover that two people are talking.
  const convo = await getConversation(id, user.id);
  if (!convo) notFound();

  await markRead(id, user.id);

  return <MessageThread initial={convo} />;
}

export const dynamic = "force-dynamic";
