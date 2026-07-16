// Map the free-form sport/discipline strings providers emit onto our Sport enum.

import type { Sport } from "@/lib/types";

const MAP: Record<string, Sport> = {
  mma: "MMA",
  "mixed martial arts": "MMA",
  ufc: "MMA",
  boxing: "BOXING",
  "pro boxing": "BOXING",
  kickboxing: "KICKBOXING",
  k1: "KICKBOXING",
  "k-1": "KICKBOXING",
  glory: "KICKBOXING",
  "muay thai": "MUAY_THAI",
  muaythai: "MUAY_THAI",
  "bare knuckle": "BARE_KNUCKLE",
  bareknuckle: "BARE_KNUCKLE",
  bkfc: "BARE_KNUCKLE",
  bjj: "BJJ",
  "brazilian jiu-jitsu": "BJJ",
  "jiu jitsu": "BJJ",
  grappling: "BJJ_NOGI",
  "no gi": "BJJ_NOGI",
  nogi: "BJJ_NOGI",
  "submission grappling": "BJJ_NOGI",
  wrestling: "WRESTLING",
  judo: "JUDO",
  taekwondo: "TAEKWONDO",
  sambo: "SAMBO",
  "combat sambo": "COMBAT_SAMBO",
};

/** Returns the mapped Sport, or `fallback` when the label is unrecognised. */
export function normalizeSport(raw: string | undefined, fallback: Sport = "MMA"): Sport {
  if (!raw) return fallback;
  const key = raw.trim().toLowerCase();
  return MAP[key] ?? fallback;
}
