import { listPendingPromoterClaims } from "@/lib/promoter/claims";
import { publicDisplayName } from "@/lib/display-name";
import { PromoterClaimReview, type ClaimRow } from "@/components/admin/promoter-claim-review";
import { requireAdminPage } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

/**
 * The promoter review queue.
 *
 * Access is enforced by the /admin layout guard, the same as every other admin
 * surface — this page adds no gate of its own, so there is one place that
 * decides who sees /admin/*.
 */
export default async function AdminPromoterClaimsPage() {
  // Guarded HERE, not only by the layout — see the note in lib/admin/guard.
  await requireAdminPage();

  const claims = await listPendingPromoterClaims();

  // Read once per request. This is an async SERVER component — it renders once
  // and does not re-render, so the clock here is a request-time fact rather
  // than the impure-render hazard the rule targets.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const rows: ClaimRow[] = claims.map((c) => ({
    id: c.id,
    status: c.status,
    note: c.note,
    createdAt: c.createdAt.toISOString(),
    user: {
      id: c.user.id,
      username: c.user.username,
      // publicDisplayName, never the raw name — signup stores whatever was
      // typed and people type their email address there.
      name: publicDisplayName(c.user),
      image: c.user.image,
      accountAgeDays: Math.floor((now - c.user.createdAt.getTime()) / 86_400_000),
    },
    org: {
      id: c.promoterOrg.id,
      name: c.promoterOrg.name,
      slug: c.promoterOrg.slug,
      verified: c.promoterOrg.verified,
      // Never the ownerId itself: the reviewer needs to know it is taken, not
      // who by, and this shape is passed to a client component.
      claimed: Boolean(c.promoterOrg.ownerId),
      eventCount: c.promoterOrg._count.events,
    },
  }));

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-lg font-bold text-chalk">Promoter applications</h1>
        <span className="text-xs text-fog">{rows.length} waiting</span>
      </div>
      <PromoterClaimReview claims={rows} />
    </div>
  );
}
