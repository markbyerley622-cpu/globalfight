import type { ReactNode } from "react";
import { PageHero } from "@/components/page-hero";
import { legalIdentity } from "@/lib/legal-config";

/** Shared chrome for the legal surfaces. Plain prose, no design flourish. */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const legal = legalIdentity();

  return (
    <>
      <PageHero eyebrow="Legal" title={title} description={intro} />
      <div className="container-cr py-10">
        {!legal.configured && (
          <div className="mb-6 rounded-lg border border-blood-500/40 bg-blood-500/10 p-4 text-sm text-blood-200">
            <b>This policy is not yet complete.</b> The operator has not supplied their legal
            entity details. This page must not be relied upon until they are configured.
          </div>
        )}

        <article className="prose-legal mx-auto max-w-3xl space-y-6 text-sm leading-relaxed text-mist">
          {children}

          <hr className="border-ink-800" />
          <section className="text-xs text-fog">
            <p><b>Who we are.</b> {legal.entityName}, {legal.entityAddress}.</p>
            <p>Governing law: {legal.jurisdiction}.</p>
            <p>Effective from: {legal.effectiveDate}.</p>
            <p>General contact: {legal.legalEmail}</p>
          </section>
        </article>
      </div>
    </>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 font-display text-lg font-bold text-chalk">{children}</h2>;
}
