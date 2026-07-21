import { redirect } from "next/navigation";

// Legacy per-bout prediction URL. The matchup now lives at /fights/[slug] — a
// real, indexable page carrying the tale of the tape, the pick control and the
// bout's arena. This route survives only so old deep-links (notifications,
// shared links, external inbound) keep landing somewhere correct. It does not
// look the fight up: /fights/[slug] already 404s an unknown slug, so a lookup
// here would only duplicate that query.
export default async function PredictionRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/fights/${slug}`);
}

export const dynamic = "force-dynamic";
