"use client";

import { useEffect, useState } from "react";
import { ROLE_LABELS } from "./content";

/**
 * The account types, as a rotating label rather than a list.
 *
 * Thirteen roles is a paragraph nobody reads and a chip grid that eats a
 * section; one word that changes says the same thing in the space of a word.
 *
 * Three things keep it accessible rather than clever:
 *
 *  · The server renders the FIRST label, and every other label is in the DOM as
 *    `aria-hidden` visually-hidden text — so a screen reader and a crawler both
 *    receive the complete list, in order, while the eye sees one at a time.
 *  · `aria-hidden` on the animated span, because a live region that changes
 *    every two seconds is an interruption, not information.
 *  · It stops entirely under `prefers-reduced-motion`, resting on the first
 *    label. Nothing is lost: the full list is still there in the hidden text.
 */
export function RoleMarquee() {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % ROLE_LABELS.length), 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="hl-roles">
      <span className="hl-roles-slot" aria-hidden="true" key={i}>
        {ROLE_LABELS[i]}
      </span>
      <span className="hl-sr">{ROLE_LABELS.join(", ")}</span>
    </span>
  );
}
