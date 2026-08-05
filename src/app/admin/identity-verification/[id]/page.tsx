import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/identity-verification";
import { ReviewForm } from "./review-form";

export const dynamic = "force-dynamic";

const TONE: Record<string, "gold" | "volt" | "red" | "neutral"> = {
  PENDING: "gold", APPROVED: "volt", DECLINED: "red", RESUBMIT_REQUESTED: "neutral",
};

const KIND_LABEL: Record<string, string> = {
  FRONT: "ID — front", BACK: "ID — back", SUPPORTING: "Supporting document",
};

/** Reading order for a reviewer, which is not alphabetical order. */
const KIND_ORDER = ["FRONT", "BACK", "SUPPORTING"];
const byKind = (a: { kind: string }, b: { kind: string }) =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);

export default async function VerificationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Storage keys are selected but NEVER rendered — the documents are reachable
  // only through the audited streaming endpoint, which re-checks authorisation
  // on every read rather than trusting that this page rendered.
  const v = await prisma.identityVerification.findUnique({
    where: { id },
    select: {
      id: true, status: true, role: true, attempt: true, submittedAt: true, reviewedAt: true,
      declineReason: true, reviewNote: true,
      user: {
        select: {
          id: true, name: true, username: true, email: true, registryRole: true,
          createdAt: true, professionalVerifiedAt: true, emailVerified: true, reputation: true,
        },
      },
      reviewer: { select: { name: true, username: true } },
      documents: {
        // Sorted in code, not by the database: `kind: "asc"` is alphabetical,
        // which puts BACK before FRONT. The front of an ID is the primary
        // document and a reviewer should meet it first.
        select: { id: true, kind: true, contentType: true, byteSize: true, scanStatus: true, deletedAt: true, uploadedAt: true },
      },
    },
  });
  if (!v) notFound();

  // Prior attempts, so a reviewer sees a resubmission pattern without leaving.
  const history = await prisma.identityVerification.findMany({
    where: { userId: v.user.id, id: { not: v.id } },
    orderBy: { submittedAt: "desc" },
    select: { id: true, status: true, attempt: true, submittedAt: true, declineReason: true },
  });

  const decided = v.status !== "PENDING";

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/identity-verification" className="tap mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-mist hover:text-chalk">
        <ArrowLeft className="size-3.5" /> Back to queue
      </Link>

      <div className="card-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-lg font-bold text-chalk">
            {v.user.name ?? v.user.username ?? "Unnamed"}
          </h1>
          <Badge tone={TONE[v.status] ?? "neutral"} size="sm">
            {v.status === "RESUBMIT_REQUESTED" ? "Resubmit requested" : v.status}
          </Badge>
          <Badge tone="outline" size="sm">{roleLabel(v.role)}</Badge>
          {v.attempt > 1 && <Badge tone="neutral" size="sm">Attempt {v.attempt}</Badge>}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Row label="Email" value={v.user.email ?? "—"} />
          <Row label="Email verified" value={v.user.emailVerified ? "Yes" : "No"} />
          <Row label="Username" value={v.user.username ?? "—"} />
          <Row label="Account created" value={v.user.createdAt.toLocaleDateString()} />
          <Row label="Submitted" value={v.submittedAt.toLocaleString()} />
          <Row label="Reputation" value={String(v.user.reputation)} />
          {/* The role AT SUBMISSION vs the role NOW. A mismatch is the single
              most useful thing on this page — it means they changed role after
              submitting, and the documents may prove the wrong thing. */}
          {v.user.registryRole !== v.role && (
            <div className="col-span-full rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-gold-200">
              Role changed since submission: submitted as{" "}
              <strong>{roleLabel(v.role)}</strong>, now <strong>{roleLabel(v.user.registryRole)}</strong>.
            </div>
          )}
        </dl>
      </div>

      <section className="mt-4 card-surface p-5">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">Documents</h2>
        {v.documents.length === 0 ? (
          <p className="mt-3 text-xs text-fog">No documents attached.</p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {[...v.documents].sort(byKind).map((d) => (
              <figure key={d.id}>
                <figcaption className="mb-1.5 flex items-center gap-2 text-2xs font-bold uppercase tracking-wide text-mist">
                  {KIND_LABEL[d.kind] ?? d.kind}
                  {d.scanStatus !== "CLEAN" && d.scanStatus !== "SKIPPED" && (
                    <Badge tone="red" size="sm">{d.scanStatus}</Badge>
                  )}
                </figcaption>
                {d.deletedAt ? (
                  <p className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-6 text-center text-xs text-fog">
                    Deleted under the retention policy on {d.deletedAt.toLocaleDateString()}.
                  </p>
                ) : (
                  <>
                    {/* Same-origin, cookie-authenticated, audited on every open. */}
                    <a href={`/api/admin/identity-verification/${v.id}/document/${d.id}`} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/admin/identity-verification/${v.id}/document/${d.id}`}
                        alt={`${KIND_LABEL[d.kind] ?? d.kind} — submitted document`}
                        className="w-full rounded-lg border border-ink-700 bg-ink-950 object-contain"
                      />
                    </a>
                    <p className="mt-1 text-3xs text-fog">
                      {d.contentType} · {(d.byteSize / 1024).toFixed(0)} KB · {d.uploadedAt.toLocaleDateString()}
                    </p>
                  </>
                )}
              </figure>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4 card-surface p-5">
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-chalk">Decision</h2>
        {decided && (
          <dl className="mb-4 grid gap-2 text-xs">
            <Row label="Decided" value={v.reviewedAt?.toLocaleString() ?? "—"} />
            <Row label="Reviewer" value={v.reviewer?.name ?? v.reviewer?.username ?? "—"} />
            {v.declineReason && <Row label="Reason given" value={v.declineReason} />}
            {v.reviewNote && <Row label="Internal note" value={v.reviewNote} />}
          </dl>
        )}
        <ReviewForm id={v.id} decided={decided} />
      </section>

      {history.length > 0 && (
        <section className="mt-4 card-surface p-5">
          <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-chalk">
            Previous attempts
          </h2>
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/admin/identity-verification/${h.id}`} className="flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-950/40 px-3 py-2.5 text-xs transition-colors hover:border-ink-700">
                  <Badge tone={TONE[h.status] ?? "neutral"} size="sm">{h.status}</Badge>
                  <span className="text-fog">Attempt {h.attempt} · {h.submittedAt.toLocaleDateString()}</span>
                  {h.declineReason && <span className="truncate text-mist">— {h.declineReason}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-3xs uppercase tracking-wide text-fog">{label}</dt>
      <dd className="mt-0.5 break-words text-mist">{value}</dd>
    </div>
  );
}
