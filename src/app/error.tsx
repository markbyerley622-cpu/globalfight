"use client";

// Route-segment error boundary. Nearly every page is `force-dynamic` and runs
// Prisma at request time, so any query/render fault would otherwise surface
// Next's raw default error screen (or a blank document in production). This
// catches it, logs the digest for correlation, and offers a recovery path.

import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { reportError } from "@/lib/observability/report";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [errorId, setErrorId] = useState<string | null>(null);

  useEffect(() => {
    // Reported, not just logged. The digest correlates this to the server-side
    // stack that instrumentation's onRequestError already captured; the id we
    // get back is shown below so a user can quote something specific instead of
    // "it broke". The raw message is never rendered.
    setErrorId(
      reportError(error, "error", {
        source: "app/error-boundary",
        path: typeof window === "undefined" ? undefined : window.location.pathname,
        digest: error.digest ?? null,
      }),
    );
  }, [error]);

  return (
    <div className="container-cr flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="font-display text-7xl font-black text-blood-500">TKO</span>
      <h1 className="mt-2 font-display text-3xl font-bold uppercase text-chalk">Something went down</h1>
      <p className="mt-2 max-w-md text-sm text-mist">
        We hit an unexpected error loading this page. It has been logged — give it another go.
      </p>
      {/* The reference. Small and quiet, but it turns an unactionable report
          ("a page broke") into one that can be found in seconds. */}
      {errorId && (
        <p className="mt-2 font-mono text-2xs text-fog">
          Reference <span className="text-mist">{errorId}</span>
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="outline">Back to Home</ButtonLink>
      </div>
    </div>
  );
}
