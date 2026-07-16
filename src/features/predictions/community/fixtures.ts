// Seed content for the community lane. These are the questions Combat Register
// owns (unlike the external market feed). They double as (a) the offline/no-DB
// fallback the UI renders, and (b) the rows the DB is auto-seeded from on first
// use in production — matched by `slug`. Content mirrors what the Predictions
// page shipped with, so nothing users already saw is lost.

import type { CommunityKind, CommunityOption } from "./types";

export type CommunitySeed = {
  slug: string;
  kind: CommunityKind;
  sport: string;
  league: string | null;
  title: string;
  subtitle: string | null;
  statusLabel: string | null;
  description: string | null;
  status: "open" | "closed" | "resolved";
  closesAt: string | null;
  options: CommunityOption[];
  featured: boolean;
  hot: boolean;
};

const willHappen: CommunityOption[] = [
  { id: "will", label: "Will happen" },
  { id: "wont", label: "Won't happen" },
];

export const COMMUNITY_SEEDS: CommunitySeed[] = [
  // ── Who wins / props (was the "Prediction Markets" list) ──
  {
    slug: "lopez-stevenson-who-wins", kind: "who_wins", sport: "Boxing", league: null,
    title: "Teofimo Lopez vs Shakur Stevenson", subtitle: "WBO Junior Welterweight Title",
    statusLabel: "FEATURED", description: "WBO Junior Welterweight Title — who wins?",
    status: "open", closesAt: null, featured: true, hot: false,
    options: [
      { id: "lopez", label: "Teofimo Lopez" },
      { id: "stevenson", label: "Shakur Stevenson" },
      { id: "draw", label: "Draw" },
    ],
  },
  {
    slug: "pantoja-asakura-who-wins", kind: "who_wins", sport: "MMA", league: "UFC",
    title: "Pantoja vs Asakura", subtitle: "UFC Flyweight Title",
    statusLabel: "HOT", description: "Who wins the main event?",
    status: "open", closesAt: null, featured: false, hot: true,
    options: [
      { id: "pantoja", label: "Alexandre Pantoja" },
      { id: "asakura", label: "Kai Asakura" },
      { id: "draw", label: "Draw" },
    ],
  },
  {
    slug: "joshua-riyadh-feb", kind: "prop", sport: "Boxing", league: null,
    title: "Will Anthony Joshua headline the Feb 2026 Riyadh card?", subtitle: "Riyadh Season",
    statusLabel: "HOT", description: null, status: "open", closesAt: null, featured: false, hot: true,
    options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
  },
  {
    slug: "jake-paul-netflix-2026", kind: "prop", sport: "Boxing", league: null,
    title: "Will Jake Paul have another Netflix fight in 2026?", subtitle: null,
    statusLabel: null, description: null, status: "open", closesAt: null, featured: false, hot: false,
    options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
  },
  {
    slug: "tko-boxing-signing", kind: "prop", sport: "Boxing", league: null,
    title: "Will TKO Boxing sign a current top-10 P4P fighter in 2026?", subtitle: null,
    statusLabel: null, description: null, status: "open", closesAt: null, featured: false, hot: false,
    options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
  },

  // ── Will it happen (was "Make This Fight / Potential Fights") ──
  {
    slug: "hearn-vs-white", kind: "will_happen", sport: "Boxing", league: null,
    title: "Eddie Hearn vs Dana White", subtitle: "Promoter Boxing Match", statusLabel: "RUMOURED",
    description: "The most talked-about novelty fight in combat sports. Hearn has offered $10M–$30M.",
    status: "open", closesAt: null, featured: false, hot: true, options: willHappen,
  },
  {
    slug: "canelo-vs-benavidez", kind: "will_happen", sport: "Boxing", league: null,
    title: "Canelo Alvarez vs David Benavidez", subtitle: "Super Middleweight", statusLabel: "BOTH SIDES INTERESTED",
    description: "The fight boxing fans have demanded for years.", status: "open", closesAt: null,
    featured: false, hot: false, options: willHappen,
  },
  {
    slug: "fury-vs-joshua", kind: "will_happen", sport: "Boxing", league: null,
    title: "Tyson Fury vs Anthony Joshua", subtitle: "Heavyweight", statusLabel: "VERY LIKELY",
    description: "The all-British heavyweight clash, more possible than ever.", status: "open",
    closesAt: null, featured: false, hot: false, options: willHappen,
  },
  {
    slug: "pereira-vs-jones", kind: "will_happen", sport: "MMA", league: "UFC",
    title: "Alex Pereira vs Jon Jones", subtitle: "Light Heavyweight", statusLabel: "BOTH SIDES INTERESTED",
    description: "The most anticipated fight in current MMA.", status: "open", closesAt: null,
    featured: false, hot: true, options: willHappen,
  },
  {
    slug: "usyk-vs-dubois", kind: "will_happen", sport: "Boxing", league: null,
    title: "Oleksandr Usyk vs Daniel Dubois", subtitle: "Heavyweight", statusLabel: "LIKELY",
    description: "Dubois gave Usyk a genuine scare. A rematch has been discussed.", status: "open",
    closesAt: null, featured: false, hot: false, options: willHappen,
  },
  {
    slug: "paul-vs-mcgregor", kind: "will_happen", sport: "Boxing", league: null,
    title: "Jake Paul vs Conor McGregor", subtitle: "Cruiserweight", statusLabel: "RUMOURED",
    description: "Discussed publicly by both sides multiple times.", status: "open", closesAt: null,
    featured: false, hot: false, options: willHappen,
  },
  {
    slug: "garcia-vs-davis", kind: "will_happen", sport: "Boxing", league: null,
    title: "Ryan Garcia vs Gervonta Davis", subtitle: "Lightweight", statusLabel: "BOTH SIDES INTERESTED",
    description: "Their first fight was one of the biggest in recent boxing history.", status: "open",
    closesAt: null, featured: false, hot: false, options: willHappen,
  },
  {
    slug: "jones-vs-makhachev", kind: "will_happen", sport: "MMA", league: "UFC",
    title: "Jon Jones vs Islam Makhachev", subtitle: "Super Fight", statusLabel: "IN NEGOTIATIONS",
    description: "The pound-for-pound number one debate settled inside the octagon.", status: "open",
    closesAt: null, featured: false, hot: false, options: willHappen,
  },
];
