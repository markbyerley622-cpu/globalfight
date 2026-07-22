"use client";

import { Fragment } from "react";
import { RICH_TEXT_TOKEN } from "@/lib/mentions";

// Renders post/reply text with two affordances, preserving line breaks:
//   • @mentions  → highlighted AND notified. The pattern lives in lib/mentions
//     so what is styled here is exactly what buys a notification.
//   • bare URLs  → safe external links.
// Everything else is rendered as plain text (no raw HTML injection).

export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  return (
    <p className={className}>
      {lines.map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {renderLine(line)}
        </Fragment>
      ))}
    </p>
  );
}

function renderLine(line: string) {
  const parts = line.split(RICH_TEXT_TOKEN);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("@")) {
      return (
        <span key={i} className="font-semibold text-blood-300" data-mention={part.slice(1)}>
          {part}
        </span>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer"
          className="break-all text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:decoration-sky-300">
          {part}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
