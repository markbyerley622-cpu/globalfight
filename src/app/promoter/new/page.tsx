import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getViewerPromoter } from "@/lib/promoter/repo";
import { promoterCapabilities, PROMOTER_STATE_COPY } from "@/lib/promoter/verification";
import { isOcrConfigured } from "@/lib/promoter/poster/ocr";
import { NewEventFlow } from "@/components/promoter/new-event-flow";
import { EmptyState } from "@/components/ui/empty-state";
import { Megaphone } from "lucide-react";

export const metadata: Metadata = {
  title: "Host an event",
  description: "Upload your poster and publish your card.",
  robots: { index: false, follow: false },
};

export default async function NewPromoterEventPage() {
  const user = await getCurrentUser();
  if (!user) redirect(`/account?returnTo=${encodeURIComponent("/promoter/new")}`);

  const promoter = await getViewerPromoter(user.id);
  const caps = promoter ? promoterCapabilities(promoter.state) : null;

  // Not a promoter, or not yet approved. The state's OWN copy is used verbatim
  // (lib/promoter/verification) so this page cannot describe the situation
  // differently from the dashboard or the API's refusal.
  if (!promoter || !caps?.uploadPoster) {
    const copy = promoter
      ? PROMOTER_STATE_COPY[promoter.state]
      : PROMOTER_STATE_COPY.NONE;
    return (
      <div className="container-cr py-10">
        <EmptyState
          icon={<Megaphone className="size-6" />}
          title={copy.label}
          body={copy.detail}
          action={{ href: "/promoter", label: "Promoter home" }}
        />
      </div>
    );
  }

  return (
    <div className="container-cr max-w-3xl py-5">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/promoter"
          aria-label="Back to your events"
          className="tap grid size-9 shrink-0 place-items-center rounded-lg text-mist transition-colors hover:bg-ink-800 hover:text-chalk"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-black uppercase tracking-tight text-chalk">
            Host an event
          </h1>
          <p className="truncate text-xs text-fog">{promoter.orgName}</p>
        </div>
      </div>

      {/* `ocrAvailable` decides whether upload leads or paste does. Offering an
          upload that cannot possibly work is worse than not offering it. */}
      <NewEventFlow ocrAvailable={isOcrConfigured()} />
    </div>
  );
}

export const dynamic = "force-dynamic";
