"use client";

// Last-resort boundary for when the ROOT layout itself throws — it replaces the
// whole document, so it must render its own <html>/<body> and cannot rely on the
// app's CSS being present. Styles are inlined and kept minimal on the dark base.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global error:", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          background: "#0a0a0b",
          color: "#e7e5e4",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, textTransform: "uppercase", margin: 0 }}>
          Something went down
        </h1>
        <p style={{ margin: 0, maxWidth: "28rem", fontSize: "0.875rem", color: "#a8a29e" }}>
          The app hit an unexpected error. It has been logged.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "1rem",
            padding: "0.6rem 1.25rem",
            borderRadius: "0.5rem",
            border: "none",
            background: "#dc2626",
            color: "white",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
