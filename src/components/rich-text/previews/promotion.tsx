"use client";

import { CalendarDays, ExternalLink } from "lucide-react";
import { PromotionLogo } from "@/components/promotion-logo";
import { registerPreview, str, num, type PreviewViewProps } from "./registry";
import { PreviewActions, PreviewAction, PreviewFact, PreviewHeader } from "./parts";

// ════════════════════════════════════════════════════════════════════════════
//  A PROMOTION.
//
//  The only kind whose identity comes from the in-code registry
//  (lib/promotions) rather than from a table — so the card's mark, brand colour
//  and name are the same values every other promotion surface in the product
//  uses, and the only thing the server actually queries is the upcoming-event
//  count.
// ════════════════════════════════════════════════════════════════════════════

function PromotionPreview({ preview }: PreviewViewProps) {
  const slug = str(preview.slug);
  const name = str(preview.name) ?? "Promotion";
  const website = str(preview.website);
  const upcoming = num(preview.upcomingEvents);

  return (
    <div className="p-3">
      <PreviewHeader
        name={name}
        subtitle={str(preview.mark)}
        fallback={<PromotionLogo promotion={slug ?? name} size="sm" />}
      />

      {upcoming !== null && (
        <PreviewFact icon={CalendarDays}>
          {upcoming > 0
            ? `${upcoming} upcoming event${upcoming === 1 ? "" : "s"}`
            : "No events on the schedule"}
        </PreviewFact>
      )}

      <PreviewActions>
        {slug && (
          <PreviewAction href={`/events?promotion=${encodeURIComponent(slug)}`} primary focusTarget>
            Schedule
          </PreviewAction>
        )}
        {website && (
          <PreviewAction href={website} external focusTarget={!slug}>
            <ExternalLink className="size-3" aria-hidden /> Website
          </PreviewAction>
        )}
      </PreviewActions>
    </div>
  );
}

registerPreview("promotion", PromotionPreview);

export { PromotionPreview };
