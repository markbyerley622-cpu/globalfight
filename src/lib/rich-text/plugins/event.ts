import { registerEntity } from "../registry";

// ════════════════════════════════════════════════════════════════════════════
//  An event — a card on a date at a venue.
// ════════════════════════════════════════════════════════════════════════════

registerEntity({
  kind: "event",
  label: "event",
  tone: "event",

  href: (e) => (e.hint?.slug ? `/events/${e.hint.slug}` : null),
  // Events are never hard-deleted — they are cancelled, and a cancelled event
  // keeps its page. So a null href here means the slug is genuinely missing
  // from the hint, which is a hydrate that found no row at all.
  unavailable: "This event is no longer listed",

  previewable: true,

  analytics: () => ({ entity: "event" }),
});
