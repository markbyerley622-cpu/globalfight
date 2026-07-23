"use client";

// Route-segment error boundary. Nearly every page is `force-dynamic` and runs
// Prisma at request time, so any query/render fault would otherwise surface
// Next's raw default error screen (or a blank document in production). This
// catches it, logs the digest for correlation, and offers a recovery path.

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest correlates this to the server-side stack in the logs; we never
    // render the raw message to the user.
    console.error("route error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="container-cr flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="font-display text-7xl font-black text-blood-500">TKO</span>
      <h1 className="mt-2 font-display text-3xl font-bold uppercase text-chalk">Something went down</h1>
      <p className="mt-2 max-w-md text-sm text-mist">
        We hit an unexpected error loading this page. It has been logged — give it another go.
      </p>
      <div className="mt-6 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="outline">Back to Home</ButtonLink>
      </div>
    </div>
  );
}
