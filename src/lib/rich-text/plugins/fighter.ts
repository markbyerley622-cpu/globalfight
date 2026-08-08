import { registerEntity } from "../registry";

// ════════════════════════════════════════════════════════════════════════════
//  A fighter — a row in the registry, not a user account.
//
//  Distinct from `mention` on purpose. A fighter is a public record that exists
//  whether or not the person has ever signed in; a mention is an account. They
//  route to different pages, they preview different facts, and conflating them
//  would mean a claimed fighter page and its owner's profile were the same
//  entity when they are two rows with two lifecycles.
// ════════════════════════════════════════════════════════════════════════════

registerEntity({
  kind: "fighter",
  labelPlural: "Fighters",
  label: "fighter",
  markShape: "round",
  tone: "fighter",

  href: (e) => (e.hint?.slug ? `/fighters/${e.hint.slug}` : null),
  unavailable: "This fighter is no longer listed",

  previewable: true,

  analytics: () => ({ entity: "fighter" }),
});
