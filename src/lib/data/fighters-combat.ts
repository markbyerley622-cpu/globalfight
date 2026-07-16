import type { Fighter } from "@/lib/types";

// MMA + Muay Thai roster (approximate, illustrative). Boxing lives in
// ./fighters; these are kept separate so each sport's source can evolve
// independently. Records are total pro records for the respective sport.

function f(p: Partial<Fighter> & { name: string; slug: string; sport: Fighter["sport"] }): Fighter {
  return {
    id: p.slug,
    wins: 0, losses: 0, draws: 0, noContests: 0,
    koWins: 0, koLosses: 0, totalRounds: 0,
    active: true,
    ...p,
  };
}

export const MMA_FIGHTERS: Fighter[] = [
  f({
    slug: "islam-makhachev", name: "Islam Makhachev", nickname: "", sport: "MMA",
    nationality: "Russia", countryCode: "RU", birthDate: "1991-10-27",
    heightCm: 178, reachCm: 178, stance: "SOUTHPAW",
    wins: 26, losses: 1, draws: 0, koWins: 6,
    bio: "Dominant grappler and former UFC lightweight champion out of Dagestan.",
  }),
  f({
    slug: "jon-jones", name: "Jon Jones", nickname: "Bones", sport: "MMA",
    nationality: "United States", countryCode: "US", birthDate: "1987-07-19",
    heightCm: 193, reachCm: 215, stance: "ORTHODOX",
    wins: 28, losses: 1, draws: 0, koWins: 10,
    bio: "Reigning UFC heavyweight champion, long regarded among the greatest of all time.",
  }),
  f({
    slug: "alex-pereira", name: "Alex Pereira", nickname: "Poatan", sport: "MMA",
    nationality: "Brazil", countryCode: "BR", birthDate: "1987-07-07",
    heightCm: 193, reachCm: 200, stance: "ORTHODOX",
    wins: 12, losses: 2, draws: 0, koWins: 9,
    bio: "Former Glory kickboxing champion turned UFC light heavyweight champion with devastating power.",
  }),
  f({
    slug: "ilia-topuria", name: "Ilia Topuria", nickname: "El Matador", sport: "MMA",
    nationality: "Georgia", countryCode: "GE", birthDate: "1997-01-21",
    heightCm: 170, reachCm: 175, stance: "ORTHODOX",
    wins: 16, losses: 0, draws: 0, koWins: 8,
    bio: "Undefeated featherweight/lightweight champion known for crisp boxing and finishing ability.",
  }),
  f({
    slug: "khamzat-chimaev", name: "Khamzat Chimaev", nickname: "Borz", sport: "MMA",
    nationality: "United Arab Emirates", countryCode: "AE", birthDate: "1994-05-01",
    heightCm: 188, reachCm: 190, stance: "ORTHODOX",
    wins: 14, losses: 0, draws: 0, koWins: 5,
    bio: "Undefeated middleweight with suffocating wrestling and pressure.",
  }),
  f({
    slug: "zhang-weili", name: "Zhang Weili", nickname: "Magnum", sport: "MMA",
    nationality: "China", countryCode: "CN", birthDate: "1989-08-13",
    heightCm: 164, reachCm: 160, stance: "ORTHODOX",
    wins: 25, losses: 3, draws: 0, koWins: 9,
    bio: "UFC women's strawweight champion and the first Chinese UFC titleholder.",
  }),
];

export const MUAY_THAI_FIGHTERS: Fighter[] = [
  f({
    slug: "rodtang-jitmuangnon", name: "Rodtang Jitmuangnon", nickname: "The Iron Man", sport: "MUAY_THAI",
    nationality: "Thailand", countryCode: "TH", birthDate: "1997-08-30",
    heightCm: 174, reachCm: 175, stance: "ORTHODOX",
    wins: 270, losses: 42, draws: 10, koWins: 70,
    bio: "ONE Flyweight Muay Thai world champion famous for relentless forward pressure and an iron chin.",
  }),
  f({
    slug: "superlek-kiatmoo9", name: "Superlek Kiatmoo9", nickname: "The Kicking Machine", sport: "MUAY_THAI",
    nationality: "Thailand", countryCode: "TH", birthDate: "1995-08-15",
    heightCm: 172, reachCm: 173, stance: "ORTHODOX",
    wins: 130, losses: 30, draws: 4, koWins: 40,
    bio: "ONE Bantamweight Muay Thai world champion regarded as one of the most technical strikers alive.",
  }),
  f({
    slug: "tawanchai-pk-saenchai", name: "Tawanchai P.K.Saenchai", nickname: "", sport: "MUAY_THAI",
    nationality: "Thailand", countryCode: "TH", birthDate: "1999-05-02",
    heightCm: 175, reachCm: 178, stance: "ORTHODOX",
    wins: 140, losses: 30, draws: 2, koWins: 35,
    bio: "ONE Featherweight Muay Thai world champion celebrated for elite kicks and elbows.",
  }),
  f({
    slug: "buakaw-banchamek", name: "Buakaw Banchamek", nickname: "", sport: "MUAY_THAI",
    nationality: "Thailand", countryCode: "TH", birthDate: "1982-05-08",
    heightCm: 174, reachCm: 175, stance: "ORTHODOX",
    wins: 240, losses: 24, draws: 12, koWins: 70,
    bio: "Global Muay Thai icon and two-time K-1 World MAX champion who brought the sport mainstream.",
  }),
  f({
    slug: "nong-o-hama", name: "Nong-O Hama", nickname: "", sport: "MUAY_THAI",
    nationality: "Thailand", countryCode: "TH", birthDate: "1986-04-15",
    heightCm: 170, reachCm: 172, stance: "ORTHODOX",
    wins: 262, losses: 54, draws: 10, koWins: 60,
    bio: "Former ONE Bantamweight Muay Thai world champion and a multi-time Lumpinee titleholder.",
  }),
];

export const COMBAT_FIGHTERS: Fighter[] = [...MMA_FIGHTERS, ...MUAY_THAI_FIGHTERS];
