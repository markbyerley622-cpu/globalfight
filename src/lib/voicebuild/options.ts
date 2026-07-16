// Fixed option lists for the controlled "Profile basics" selects. Kept in one
// place so the UI (and, later, validation/extraction) share the same source.

export const ROLE_DISCIPLINE_OPTIONS = [
  "Professional Boxer",
  "Amateur Boxer",
  "MMA Fighter",
  "Kickboxer",
  "Muay Thai Fighter",
  "Bare Knuckle Boxer",
  "Trainer",
  "Coach",
  "Promoter",
  "Combat Sports Athlete",
] as const;

export const DIVISION_OPTIONS = [
  "Minimumweight",
  "Light Flyweight",
  "Flyweight",
  "Super Flyweight",
  "Bantamweight",
  "Super Bantamweight",
  "Featherweight",
  "Super Featherweight",
  "Lightweight",
  "Super Lightweight",
  "Welterweight",
  "Super Welterweight",
  "Middleweight",
  "Super Middleweight",
  "Light Heavyweight",
  "Cruiserweight",
  "Bridgerweight",
  "Heavyweight",
] as const;
