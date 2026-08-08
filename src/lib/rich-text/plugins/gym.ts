import { registerEntity } from "../registry";

// ════════════════════════════════════════════════════════════════════════════
//  A gym — a place with members.
// ════════════════════════════════════════════════════════════════════════════

registerEntity({
  kind: "gym",
  labelPlural: "Gyms",
  label: "gym",
  markShape: "square",
  tone: "place",

  href: (e) => (e.hint?.slug ? `/gyms/${e.hint.slug}` : null),
  unavailable: "This gym is no longer listed",

  previewable: true,

  analytics: () => ({ entity: "gym" }),
});
