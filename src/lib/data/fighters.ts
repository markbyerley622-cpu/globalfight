import type { Fighter } from "@/lib/types";
import { COMBAT_FIGHTERS } from "./fighters-combat";

// Current-era boxing data (approximate, illustrative — refreshed by the
// licensed API providers in production). Used by the mock-data repository.

function f(p: Partial<Fighter> & { name: string; slug: string }): Fighter {
  return {
    id: p.slug,
    sport: "BOXING",
    wins: 0, losses: 0, draws: 0, noContests: 0,
    koWins: 0, koLosses: 0, totalRounds: 0,
    active: true,
    ...p,
  };
}

export const FIGHTERS: Fighter[] = [
  f({
    slug: "oleksandr-usyk", name: "Oleksandr Usyk", nickname: "The Cat",
    nationality: "Ukraine", countryCode: "UA",
    birthDate: "1987-01-17", birthPlace: "Simferopol, Crimea",
    heightCm: 191, reachCm: 198, stance: "SOUTHPAW", debutDate: "2013-11-09",
    gym: "Usyk Promotions", promoter: "Alex Krassyuk",
    wins: 23, losses: 0, draws: 0, koWins: 14, totalRounds: 0,
    bio: "Undisputed heavyweight champion and former undisputed cruiserweight king. Olympic gold medalist (London 2012) and one of the finest technicians of the modern era.",
    titles: [
      { body: "WBA", weight: "Heavyweight", current: true },
      { body: "WBC", weight: "Heavyweight", current: true },
      { body: "WBO", weight: "Heavyweight", current: true },
    ],
  }),
  f({
    slug: "tyson-fury", name: "Tyson Fury", nickname: "The Gypsy King",
    nationality: "United Kingdom", countryCode: "GB",
    birthDate: "1988-08-12", birthPlace: "Manchester, England",
    heightCm: 206, reachCm: 216, stance: "ORTHODOX", debutDate: "2008-12-06",
    wins: 34, losses: 2, draws: 1, koWins: 24,
    bio: "Lineal heavyweight champion known for his unorthodox movement at 6'9\". Famous for the trilogy with Deontay Wilder.",
  }),
  f({
    slug: "artur-beterbiev", name: "Artur Beterbiev", nickname: "The Krusher",
    nationality: "Russia", countryCode: "RU",
    birthDate: "1985-01-21", heightCm: 182, reachCm: 185, stance: "ORTHODOX",
    wins: 21, losses: 1, draws: 0, koWins: 20,
    bio: "Former undisputed light heavyweight champion with a near-perfect knockout ratio.",
  }),
  f({
    slug: "dmitry-bivol", name: "Dmitry Bivol", nickname: "",
    nationality: "Kyrgyzstan", countryCode: "KG",
    birthDate: "1990-12-18", heightCm: 183, reachCm: 184, stance: "ORTHODOX",
    wins: 24, losses: 1, draws: 0, koWins: 12,
    bio: "Undisputed light heavyweight champion. Handed Canelo Álvarez a decisive defeat in 2022.",
    titles: [{ body: "WBA", weight: "Light Heavyweight", current: true }],
  }),
  f({
    slug: "terence-crawford", name: "Terence Crawford", nickname: "Bud",
    nationality: "United States", countryCode: "US",
    birthDate: "1987-09-28", birthPlace: "Omaha, Nebraska",
    heightCm: 173, reachCm: 188, stance: "SWITCH",
    wins: 41, losses: 0, draws: 0, koWins: 31,
    bio: "Two-weight undisputed champion and pound-for-pound great. A switch-hitting marvel.",
    titles: [{ body: "WBA", weight: "Super Welterweight", current: true }],
  }),
  f({
    slug: "canelo-alvarez", name: "Saúl Álvarez", nickname: "Canelo",
    nationality: "Mexico", countryCode: "MX",
    birthDate: "1990-07-18", birthPlace: "Guadalajara",
    heightCm: 173, reachCm: 179, stance: "ORTHODOX",
    wins: 62, losses: 2, draws: 2, koWins: 39,
    bio: "Mexico's biggest star and former undisputed super middleweight champion.",
    titles: [
      { body: "WBC", weight: "Super Middleweight", current: true },
      { body: "WBA", weight: "Super Middleweight", current: true },
    ],
  }),
  f({
    slug: "naoya-inoue", name: "Naoya Inoue", nickname: "The Monster",
    nationality: "Japan", countryCode: "JP",
    birthDate: "1993-04-10", heightCm: 165, reachCm: 171, stance: "ORTHODOX",
    wins: 28, losses: 0, draws: 0, koWins: 25,
    bio: "Two-division undisputed champion and the consensus pound-for-pound #1 for many. Devastating body puncher.",
    titles: [
      { body: "WBC", weight: "Super Bantamweight", current: true },
      { body: "WBA", weight: "Super Bantamweight", current: true },
      { body: "IBF", weight: "Super Bantamweight", current: true },
      { body: "WBO", weight: "Super Bantamweight", current: true },
    ],
  }),
  f({
    slug: "gervonta-davis", name: "Gervonta Davis", nickname: "Tank",
    nationality: "United States", countryCode: "US",
    birthDate: "1994-11-07", birthPlace: "Baltimore", heightCm: 166, reachCm: 172,
    stance: "SOUTHPAW", wins: 30, losses: 0, draws: 1, koWins: 28,
    bio: "Explosive southpaw knockout artist and one of boxing's biggest PPV draws.",
    titles: [{ body: "WBA", weight: "Lightweight", current: true }],
  }),
  f({
    slug: "shakur-stevenson", name: "Shakur Stevenson", nickname: "",
    nationality: "United States", countryCode: "US",
    birthDate: "1997-06-28", heightCm: 173, reachCm: 175, stance: "SOUTHPAW",
    wins: 22, losses: 0, draws: 0, koWins: 10,
    bio: "Slick three-weight world champion with elite defensive instincts.",
    titles: [{ body: "WBC", weight: "Lightweight", current: true }],
  }),
  f({
    slug: "vasiliy-lomachenko", name: "Vasiliy Lomachenko", nickname: "Loma",
    nationality: "Ukraine", countryCode: "UA",
    birthDate: "1988-02-17", heightCm: 170, reachCm: 166, stance: "SOUTHPAW",
    wins: 18, losses: 3, draws: 0, koWins: 12,
    bio: "Footwork virtuoso and former three-weight champion. Two-time Olympic gold medalist.",
    titles: [{ body: "IBF", weight: "Lightweight", current: true }],
  }),
  f({
    slug: "devin-haney", name: "Devin Haney", nickname: "The Dream",
    nationality: "United States", countryCode: "US",
    birthDate: "1998-11-17", heightCm: 175, reachCm: 180, stance: "ORTHODOX",
    wins: 31, losses: 0, draws: 1, koWins: 15,
    bio: "Former undisputed lightweight champion with a polished jab and ring IQ.",
  }),
  f({
    slug: "jesse-rodriguez", name: "Jesse Rodríguez", nickname: "Bam",
    nationality: "United States", countryCode: "US",
    birthDate: "2000-01-18", heightCm: 165, reachCm: 163, stance: "SOUTHPAW",
    wins: 20, losses: 0, draws: 0, koWins: 13,
    bio: "Young undisputed-level talent dominating the lower weight classes.",
    titles: [{ body: "WBC", weight: "Super Flyweight", current: true }],
  }),
  f({
    slug: "david-benavidez", name: "David Benavidez", nickname: "El Monstruo",
    nationality: "United States", countryCode: "US",
    birthDate: "1996-12-17", heightCm: 188, reachCm: 187, stance: "ORTHODOX",
    wins: 29, losses: 0, draws: 0, koWins: 24,
    bio: "High-volume pressure fighter and the most avoided man at 168/175.",
    titles: [{ body: "WBC", weight: "Light Heavyweight", current: true }],
  }),
  f({
    slug: "anthony-joshua", name: "Anthony Joshua", nickname: "AJ",
    nationality: "United Kingdom", countryCode: "GB",
    birthDate: "1989-10-15", heightCm: 198, reachCm: 208, stance: "ORTHODOX",
    wins: 28, losses: 4, draws: 0, koWins: 25,
    bio: "Two-time unified heavyweight champion and 2012 Olympic gold medalist.",
  }),
  f({
    slug: "deontay-wilder", name: "Deontay Wilder", nickname: "The Bronze Bomber",
    nationality: "United States", countryCode: "US",
    birthDate: "1985-10-22", heightCm: 201, reachCm: 211, stance: "ORTHODOX",
    wins: 43, losses: 4, draws: 1, koWins: 42,
    bio: "Owner of one of the most fearsome right hands in heavyweight history.",
  }),
  f({
    slug: "jai-opetaia", name: "Jai Opetaia", nickname: "The Hunter",
    nationality: "Australia", countryCode: "AU",
    birthDate: "1995-05-25", heightCm: 188, reachCm: 188, stance: "SOUTHPAW",
    wins: 26, losses: 0, draws: 0, koWins: 20,
    bio: "IBF cruiserweight champion and the lineal king of the division.",
    titles: [{ body: "IBF", weight: "Cruiserweight", current: true }],
  }),
  f({
    slug: "janibek-alimkhanuly", name: "Janibek Alimkhanuly", nickname: "Qazaq Style",
    nationality: "Kazakhstan", countryCode: "KZ",
    birthDate: "1993-01-30", heightCm: 180, reachCm: 191, stance: "SOUTHPAW",
    wins: 16, losses: 0, draws: 0, koWins: 11,
    bio: "Unified middleweight champion and avoided southpaw technician.",
    titles: [
      { body: "WBO", weight: "Middleweight", current: true },
      { body: "IBF", weight: "Middleweight", current: true },
    ],
  }),
  f({
    slug: "jaron-ennis", name: "Jaron Ennis", nickname: "Boots",
    nationality: "United States", countryCode: "US",
    birthDate: "1997-07-13", heightCm: 180, reachCm: 185, stance: "ORTHODOX",
    wins: 33, losses: 0, draws: 0, koWins: 29,
    bio: "Switch-hitting welterweight champion regarded as a future P4P star.",
    titles: [{ body: "IBF", weight: "Welterweight", current: true }],
  }),
  f({
    slug: "junto-nakatani", name: "Junto Nakatani", nickname: "",
    nationality: "Japan", countryCode: "JP",
    birthDate: "1997-11-21", heightCm: 175, reachCm: 173, stance: "SOUTHPAW",
    wins: 29, losses: 0, draws: 0, koWins: 22,
    bio: "Three-weight champion and one of the most feared punchers in the lower divisions.",
    titles: [{ body: "WBC", weight: "Bantamweight", current: true }],
  }),
  f({
    slug: "subriel-matias", name: "Subriel Matías", nickname: "El Maravilla",
    nationality: "Puerto Rico", countryCode: "PR",
    birthDate: "1992-03-30", heightCm: 173, reachCm: 173, stance: "ORTHODOX",
    wins: 22, losses: 2, draws: 0, koWins: 22,
    bio: "Relentless body-punching pressure fighter at super lightweight.",
  }),
  // MMA + Muay Thai roster (see ./fighters-combat).
  ...COMBAT_FIGHTERS,
];

export const FIGHTERS_BY_SLUG = new Map(FIGHTERS.map((x) => [x.slug, x]));
