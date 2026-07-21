// Onboarding choices — client + server safe (no server-only import), so the
// flow and the API validate against the SAME list. Previously these were
// declared twice, which meant a role could be offered in the UI and rejected by
// the server without either side changing.

export const ROLES = [
  { value: "fan", label: "Fan", blurb: "I watch and predict" },
  { value: "fighter", label: "Fighter", blurb: "I compete" },
  { value: "coach", label: "Coach", blurb: "I corner and train" },
  { value: "media", label: "Media", blurb: "I cover the sport" },
] as const;

export type RoleValue = (typeof ROLES)[number]["value"];

export const SPORT_MIN = 2;
export const SPORT_MAX = 5;
