// ════════════════════════════════════════════════════════════════════════════
//  Registry roles — ONE list, three consumers.
//
//  There were three. `auth.ts` allowed eleven values, the signup screen offered
//  three of them, and onboarding offered a different four — so a role could be
//  accepted by the server and unreachable in the UI, or offered by onboarding
//  and absent from signup. onboarding-options.ts already carried a comment
//  warning about exactly this ("Previously these were declared twice, which
//  meant a role could be offered in the UI and rejected by the server"); the
//  list had simply drifted apart again.
//
//  This file is the single source. It is client- AND server-safe (no
//  server-only import, no env access), so the signup form, the onboarding
//  flow, the profile editor and the API all validate against the same values.
//
//  Adding a role is one entry here. Nothing else changes.
//
//  `value` is what lands in User.registryRole. Values are STABLE — renaming one
//  orphans every row that already holds it, so labels change freely and values
//  never do.
// ════════════════════════════════════════════════════════════════════════════

export interface RegistryRoleDef {
  value: string;
  label: string;
  blurb: string;
  /** Grouping for the signup grid. */
  group: "compete" | "corner" | "business" | "broadcast";
  /** Roles whose identity is a claimable public record, not just a preference.
   *  Drives the "verify this" nudge after signup. */
  claimable?: boolean;
}

export const REGISTRY_ROLE_DEFS: readonly RegistryRoleDef[] = [
  // ── In the cage ──
  { value: "fan", label: "Fan", blurb: "Watch, predict and argue", group: "compete" },
  { value: "fighter", label: "Fighter", blurb: "I compete — claim my record", group: "compete", claimable: true },
  { value: "world_champion", label: "World Champion", blurb: "Current or former titleholder", group: "compete", claimable: true },

  // ── In the corner ──
  { value: "coach", label: "Coach", blurb: "I train and corner fighters", group: "corner" },
  { value: "manager", label: "Manager", blurb: "I represent fighters", group: "corner" },
  { value: "official", label: "Referee / Judge", blurb: "I officiate bouts", group: "corner" },
  { value: "medic", label: "Medic", blurb: "Cageside medical", group: "corner" },
  { value: "ring_girl", label: "Ring Card Holder", blurb: "Between-rounds cards", group: "broadcast" },

  // ── The business ──
  { value: "gym", label: "Gym / Academy", blurb: "I run a gym — claim its page", group: "business", claimable: true },
  { value: "promoter", label: "Organisation", blurb: "A promotion putting on cards", group: "business", claimable: true },

  // ── Telling the story ──
  { value: "media", label: "Media", blurb: "I cover the sport", group: "broadcast" },
  { value: "photographer", label: "Photographer", blurb: "I shoot fights and fighters", group: "broadcast" },
  { value: "announcer", label: "Announcer", blurb: "Commentary and ring announcing", group: "broadcast" },
] as const;

/** Allow-list for every API that accepts a role. */
export const REGISTRY_ROLE_VALUES = REGISTRY_ROLE_DEFS.map((r) => r.value);

export function isRegistryRole(v: unknown): v is string {
  return typeof v === "string" && REGISTRY_ROLE_VALUES.includes(v);
}

export function roleDef(value: string | null | undefined): RegistryRoleDef {
  return REGISTRY_ROLE_DEFS.find((r) => r.value === value) ?? REGISTRY_ROLE_DEFS[0];
}

/** Human label, with a safe fallback for any legacy value not in the list. */
export function roleLabel(value: string | null | undefined): string {
  const hit = REGISTRY_ROLE_DEFS.find((r) => r.value === value);
  if (hit) return hit.label;
  // A row written before this role existed still has to render as something.
  return (value ?? "fan").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const ROLE_GROUPS: { id: RegistryRoleDef["group"]; label: string }[] = [
  { id: "compete", label: "In the cage" },
  { id: "corner", label: "In the corner" },
  { id: "business", label: "The business" },
  { id: "broadcast", label: "Telling the story" },
];

export function rolesInGroup(group: RegistryRoleDef["group"]): RegistryRoleDef[] {
  return REGISTRY_ROLE_DEFS.filter((r) => r.group === group);
}

// ── Disciplines & promotions ────────────────────────────────────────────────
// Profile preference vocabularies. Same reasoning: declared once, used by the
// profile editor, onboarding and any future filter.

export const DISCIPLINES = [
  "MMA", "Boxing", "Muay Thai", "Kickboxing", "BJJ", "Wrestling",
  "Judo", "Karate", "Taekwondo", "Sambo", "Bare Knuckle", "Grappling",
] as const;
