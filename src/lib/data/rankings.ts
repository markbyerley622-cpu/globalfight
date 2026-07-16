import type { WeightClassRanking, Champion, RankMovement, SanctioningBody } from "@/lib/types";
import { FIGHTERS_BY_SLUG } from "./fighters";

export const WEIGHT_CLASSES = [
  { name: "Heavyweight", slug: "heavyweight", limitLbs: null },
  { name: "Cruiserweight", slug: "cruiserweight", limitLbs: 200 },
  { name: "Light Heavyweight", slug: "light-heavyweight", limitLbs: 175 },
  { name: "Super Middleweight", slug: "super-middleweight", limitLbs: 168 },
  { name: "Middleweight", slug: "middleweight", limitLbs: 160 },
  { name: "Super Welterweight", slug: "super-welterweight", limitLbs: 154 },
  { name: "Welterweight", slug: "welterweight", limitLbs: 147 },
  { name: "Super Lightweight", slug: "super-lightweight", limitLbs: 140 },
  { name: "Lightweight", slug: "lightweight", limitLbs: 135 },
  { name: "Super Featherweight", slug: "super-featherweight", limitLbs: 130 },
  { name: "Featherweight", slug: "featherweight", limitLbs: 126 },
  { name: "Super Bantamweight", slug: "super-bantamweight", limitLbs: 122 },
  { name: "Bantamweight", slug: "bantamweight", limitLbs: 118 },
  { name: "Super Flyweight", slug: "super-flyweight", limitLbs: 115 },
  { name: "Flyweight", slug: "flyweight", limitLbs: 112 },
  { name: "Minimumweight", slug: "minimumweight", limitLbs: 105 },
] as const;

type Row = [slug: string, rank: number, movement: RankMovement, rating: number, prev?: number];

function build(weightClass: string, slug: string, rows: Row[], p4p = false): WeightClassRanking {
  return {
    weightClass, slug, isPoundForPound: p4p, updatedAt: "2026-05-28T06:00:00Z",
    rankings: rows
      .map(([s, rank, movement, rating, prev]) => {
        const fighter = FIGHTERS_BY_SLUG.get(s);
        if (!fighter) return null;
        return { rank, movement, rating, previousRank: prev, fighter };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  };
}

export const POUND_FOR_POUND = build("Pound for Pound", "pound-for-pound", [
  ["naoya-inoue", 1, "SAME", 100.0],
  ["oleksandr-usyk", 2, "SAME", 99.2],
  ["terence-crawford", 3, "UP", 98.4, 4],
  ["dmitry-bivol", 4, "DOWN", 97.1, 3],
  ["artur-beterbiev", 5, "SAME", 96.8],
  ["canelo-alvarez", 6, "DOWN", 94.0, 5],
  ["gervonta-davis", 7, "UP", 92.6, 9],
  ["shakur-stevenson", 8, "SAME", 91.9],
  ["junto-nakatani", 9, "UP", 91.2, 11],
  ["jesse-rodriguez", 10, "UP", 90.5, 12],
], true);

export const DIVISION_RANKINGS: WeightClassRanking[] = [
  build("Heavyweight", "heavyweight", [
    ["oleksandr-usyk", 1, "SAME", 99.2],
    ["tyson-fury", 2, "SAME", 88.4],
    ["anthony-joshua", 3, "UP", 82.1, 4],
    ["deontay-wilder", 4, "DOWN", 74.5, 3],
  ]),
  build("Cruiserweight", "cruiserweight", [
    ["jai-opetaia", 1, "SAME", 90.3],
  ]),
  build("Light Heavyweight", "light-heavyweight", [
    ["dmitry-bivol", 1, "SAME", 97.1],
    ["artur-beterbiev", 2, "SAME", 96.8],
    ["david-benavidez", 3, "UP", 89.0, 4],
  ]),
  build("Super Middleweight", "super-middleweight", [
    ["canelo-alvarez", 1, "SAME", 94.0],
    ["david-benavidez", 2, "SAME", 89.0],
  ]),
  build("Middleweight", "middleweight", [
    ["janibek-alimkhanuly", 1, "SAME", 88.7],
  ]),
  build("Super Welterweight", "super-welterweight", [
    ["terence-crawford", 1, "SAME", 98.4],
  ]),
  build("Welterweight", "welterweight", [
    ["jaron-ennis", 1, "SAME", 90.9],
  ]),
  build("Super Lightweight", "super-lightweight", [
    ["subriel-matias", 1, "UP", 84.2, 2],
  ]),
  build("Lightweight", "lightweight", [
    ["gervonta-davis", 1, "SAME", 92.6],
    ["shakur-stevenson", 2, "SAME", 91.9],
    ["vasiliy-lomachenko", 3, "DOWN", 90.1, 2],
    ["devin-haney", 4, "DOWN", 88.3, 3],
  ]),
  build("Super Bantamweight", "super-bantamweight", [
    ["naoya-inoue", 1, "SAME", 100.0],
  ]),
  build("Bantamweight", "bantamweight", [
    ["junto-nakatani", 1, "SAME", 91.2],
  ]),
  build("Super Flyweight", "super-flyweight", [
    ["jesse-rodriguez", 1, "SAME", 90.5],
  ]),
];

const ch = (
  body: SanctioningBody, weightClass: string, weightClassSlug: string,
  slug: string, since: string, defenses: number,
): Champion | null => {
  const fighter = FIGHTERS_BY_SLUG.get(slug);
  return fighter ? { body, weightClass, weightClassSlug, since, defenses, fighter } : null;
};

export const CHAMPIONS: Champion[] = [
  ch("WBC", "Heavyweight", "heavyweight", "oleksandr-usyk", "2024-05-18", 2),
  ch("WBA", "Heavyweight", "heavyweight", "oleksandr-usyk", "2024-05-18", 2),
  ch("WBO", "Heavyweight", "heavyweight", "oleksandr-usyk", "2024-05-18", 2),
  ch("IBF", "Cruiserweight", "cruiserweight", "jai-opetaia", "2022-07-02", 3),
  ch("WBA", "Light Heavyweight", "light-heavyweight", "dmitry-bivol", "2017-11-04", 8),
  ch("WBC", "Light Heavyweight", "light-heavyweight", "david-benavidez", "2025-02-22", 1),
  ch("WBC", "Super Middleweight", "super-middleweight", "canelo-alvarez", "2021-05-08", 6),
  ch("WBA", "Super Middleweight", "super-middleweight", "canelo-alvarez", "2021-05-08", 6),
  ch("WBO", "Middleweight", "middleweight", "janibek-alimkhanuly", "2022-11-12", 4),
  ch("WBA", "Super Welterweight", "super-welterweight", "terence-crawford", "2025-08-01", 0),
  ch("IBF", "Welterweight", "welterweight", "jaron-ennis", "2023-07-08", 3),
  ch("WBA", "Lightweight", "lightweight", "gervonta-davis", "2023-01-07", 4),
  ch("WBC", "Lightweight", "lightweight", "shakur-stevenson", "2024-11-16", 2),
  ch("IBF", "Lightweight", "lightweight", "vasiliy-lomachenko", "2024-05-12", 1),
  ch("WBC", "Super Bantamweight", "super-bantamweight", "naoya-inoue", "2023-07-25", 4),
  ch("WBC", "Bantamweight", "bantamweight", "junto-nakatani", "2024-02-24", 3),
  ch("WBC", "Super Flyweight", "super-flyweight", "jesse-rodriguez", "2024-06-29", 2),
].filter((x): x is Champion => x !== null);
