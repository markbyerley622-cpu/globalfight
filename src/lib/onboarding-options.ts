// Onboarding choices — client + server safe (no server-only import), so the
// flow and the API validate against the SAME list. Previously these were
// declared twice, which meant a role could be offered in the UI and rejected by
// the server without either side changing.

// Re-exported, not re-declared. This file used to carry its own four-role list
// while signup carried three and the server allowed eleven — the exact drift
// the comment above warns about. src/lib/roles.ts is now the only list.
export { REGISTRY_ROLE_DEFS as ROLES } from "@/lib/roles";
export type RoleValue = string;

export const SPORT_MIN = 2;
export const SPORT_MAX = 5;
