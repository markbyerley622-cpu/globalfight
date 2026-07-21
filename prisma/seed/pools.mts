import type { Sport, UserRole } from "@prisma/client";

// ── Persona archetypes ──────────────────────────────────────────────────────
// Each archetype is a believable psychological type from the plan's "four
// audiences". A pool of individuals is generated from each, so no two users feel
// the same, but each behaves in-character: how they pick, how confident they are,
// how good they actually are, and how they talk.

export type PickStyle = "favourite" | "underdog" | "technical" | "homer" | "contrarian" | "casual";
export type Tone = "casual" | "technical" | "analyst" | "hype" | "trashtalk";
export type Activity = "whale" | "regular" | "lurker";
export type Region = "anglo" | "brazil" | "thai" | "slavic" | "japanese" | "hispanic" | "gulf" | "filipino";

export interface Persona {
  key: string;
  label: string; // shown nowhere; documents intent
  registryRole: string; // fan|fighter|coach|gym|promoter|manager|official|media
  role: UserRole;
  count: number; // how many individuals to spawn
  sports: Sport[]; // favourite disciplines
  region: Region;
  pickStyle: PickStyle;
  methodBias: "ko" | "sub" | "decision" | "mixed";
  confidence: "high" | "low" | "calibrated";
  activity: Activity;
  skill: number; // 0..1 — how often their resolved picks land
  collector: boolean;
  tone: Tone;
  tagline: string; // bio strapline, slot {gym}/{city} filled in
}

export const ARCHETYPES: Persona[] = [
  { key: "ufc-casual", label: "UFC casual", registryRole: "fan", role: "USER", count: 9,
    sports: ["MMA"], region: "anglo", pickStyle: "favourite", methodBias: "ko", confidence: "high",
    activity: "regular", skill: 0.5, collector: false, tone: "casual",
    tagline: "Here for the main card and the walk-offs. {city}." },
  { key: "hardcore-grappler", label: "Hardcore grappler", registryRole: "fan", role: "USER", count: 6,
    sports: ["BJJ", "BJJ_NOGI", "WRESTLING", "MMA"], region: "anglo", pickStyle: "technical", methodBias: "sub",
    confidence: "calibrated", activity: "whale", skill: 0.67, collector: true, tone: "technical",
    tagline: "Positional before submission. I watch the hands fighting, not the highlight. {gym}." },
  { key: "one-fan", label: "ONE Championship fan", registryRole: "fan", role: "USER", count: 6,
    sports: ["MUAY_THAI", "MMA", "KICKBOXING"], region: "filipino", pickStyle: "favourite", methodBias: "mixed",
    confidence: "high", activity: "regular", skill: 0.55, collector: true, tone: "hype",
    tagline: "Circle > cage. Muay Thai is the art. {city}." },
  { key: "muay-thai-coach", label: "Muay Thai coach", registryRole: "coach", role: "EXPERT", count: 4,
    sports: ["MUAY_THAI", "K1", "KICKBOXING"], region: "thai", pickStyle: "technical", methodBias: "ko",
    confidence: "calibrated", activity: "regular", skill: 0.72, collector: false, tone: "analyst",
    tagline: "Kru at {gym}. Teep, timing, tempo — the rest is noise." },
  { key: "amateur-boxer", label: "Amateur boxer", registryRole: "fighter", role: "USER", count: 6,
    sports: ["BOXING"], region: "hispanic", pickStyle: "favourite", methodBias: "decision", confidence: "high",
    activity: "regular", skill: 0.5, collector: false, tone: "casual",
    tagline: "3–1 amateur out of {gym}. Sweet science only." },
  { key: "wrestling-coach", label: "Wrestling coach", registryRole: "coach", role: "USER", count: 4,
    sports: ["WRESTLING", "MMA"], region: "slavic", pickStyle: "technical", methodBias: "decision",
    confidence: "calibrated", activity: "regular", skill: 0.66, collector: false, tone: "analyst",
    tagline: "Positions win fights. Head coach, {gym}." },
  { key: "bjj-blackbelt", label: "BJJ black belt", registryRole: "coach", role: "MODERATOR", count: 4,
    sports: ["BJJ", "BJJ_NOGI", "MMA"], region: "brazil", pickStyle: "underdog", methodBias: "sub",
    confidence: "calibrated", activity: "whale", skill: 0.7, collector: true, tone: "technical",
    tagline: "Faixa-preta. {gym}. If it goes to the mat, I already know how it ends." },
  { key: "kickboxing-addict", label: "Kickboxing addict", registryRole: "fan", role: "USER", count: 6,
    sports: ["KICKBOXING", "K1", "MUAY_THAI"], region: "slavic", pickStyle: "contrarian", methodBias: "ko",
    confidence: "high", activity: "whale", skill: 0.47, collector: false, tone: "trashtalk",
    tagline: "GLORY nights only. If it's not a war I'm not watching. {city}." },
  { key: "regional-prospect", label: "Regional MMA prospect", registryRole: "fighter", role: "USER", count: 5,
    sports: ["MMA", "BARE_KNUCKLE"], region: "anglo", pickStyle: "homer", methodBias: "ko", confidence: "high",
    activity: "regular", skill: 0.52, collector: false, tone: "hype",
    tagline: "Pro prospect, {city}. 6–0 and calling out the division." },
  { key: "combat-journalist", label: "Combat journalist", registryRole: "media", role: "EXPERT", count: 3,
    sports: ["MMA", "BOXING", "MUAY_THAI"], region: "anglo", pickStyle: "technical", methodBias: "decision",
    confidence: "calibrated", activity: "whale", skill: 0.64, collector: false, tone: "analyst",
    tagline: "Covering the sport nobody else does. Cageside since '14. {city}." },
  { key: "boxing-purist", label: "Boxing purist", registryRole: "fan", role: "USER", count: 5,
    sports: ["BOXING", "BARE_KNUCKLE"], region: "anglo", pickStyle: "favourite", methodBias: "decision",
    confidence: "calibrated", activity: "regular", skill: 0.58, collector: true, tone: "analyst",
    tagline: "Twelve rounds and a scorecard. The rest is entertainment. {city}." },
  { key: "gulf-newcomer", label: "Dubai gym newcomer", registryRole: "fan", role: "USER", count: 5,
    sports: ["MMA", "MUAY_THAI"], region: "gulf", pickStyle: "casual", methodBias: "mixed", confidence: "low",
    activity: "lurker", skill: 0.49, collector: false, tone: "casual",
    tagline: "New to the sport, training out of {gym} in {city}. Learning fast." },
  { key: "sambo-nationalist", label: "Sambo diehard", registryRole: "fan", role: "USER", count: 3,
    sports: ["SAMBO", "COMBAT_SAMBO", "JUDO"], region: "slavic", pickStyle: "underdog", methodBias: "sub",
    confidence: "high", activity: "regular", skill: 0.6, collector: true, tone: "trashtalk",
    tagline: "Sambo built the best fighters alive and you know it. {city}." },
];

// ── Names by region ─────────────────────────────────────────────────────────
export const NAMES: Record<Region, { first: string[]; last: string[] }> = {
  anglo: { first: ["Jake", "Marcus", "Danny", "Ryan", "Connor", "Liam", "Tyler", "Sean", "Aaron", "Cole", "Brett", "Owen", "Nate", "Josh", "Kayla", "Megan", "Sam", "Alex", "Jordan", "Casey"],
    last: ["Sullivan", "Brooks", "Hayes", "Whitaker", "Doyle", "Callahan", "Reed", "Foster", "Nash", "Boyd", "Sharpe", "Mercer", "Quinn", "Vaughn", "Ellis"] },
  brazil: { first: ["Rafael", "Bruno", "Diego", "Thiago", "Lucas", "Gabriel", "Rodrigo", "Vinicius", "Caio", "Matheus", "Amanda", "Beatriz", "Leandro", "Fabio", "Igor"],
    last: ["Silva", "Souza", "Oliveira", "Costa", "Pereira", "Almeida", "Nogueira", "Barbosa", "Ferreira", "Gracie", "Machado", "Mendes", "Ribeiro"] },
  thai: { first: ["Somchai", "Anan", "Kiat", "Nattapong", "Petch", "Sittichai", "Rungrat", "Yodsak", "Chai", "Decha", "Ploy", "Nong", "Arun", "Weerapon"],
    last: ["Sitthichai", "Wongsawat", "Charoen", "Sae-lao", "Boonchu", "Kittisak", "Phromwong", "Rattanachai", "Suwan"] },
  slavic: { first: ["Dmitri", "Sergei", "Ivan", "Nikolai", "Andrei", "Vladimir", "Anton", "Roman", "Pavel", "Artem", "Yuri", "Maxim", "Oleg", "Vasily", "Katya"],
    last: ["Volkov", "Petrov", "Ivanov", "Sokolov", "Kuznetsov", "Popov", "Novak", "Marchenko", "Zadorov", "Levin", "Orlov", "Baranov"] },
  japanese: { first: ["Kenji", "Takeshi", "Hiroshi", "Yuki", "Daichi", "Ryo", "Sho", "Kaito", "Haru", "Ren", "Aya", "Mei"],
    last: ["Tanaka", "Sato", "Yamamoto", "Nakamura", "Kobayashi", "Watanabe", "Ito", "Suzuki", "Takahashi"] },
  hispanic: { first: ["Carlos", "Miguel", "Javier", "Diego", "Luis", "Andres", "Emilio", "Rafa", "Hector", "Alejandro", "Sofia", "Valeria", "Ramon", "Cesar"],
    last: ["Ramirez", "Torres", "Gonzalez", "Herrera", "Vargas", "Castillo", "Reyes", "Morales", "Delgado", "Ortega", "Nunez"] },
  gulf: { first: ["Omar", "Khalid", "Yousef", "Hamdan", "Rashid", "Faisal", "Tariq", "Saif", "Zayed", "Adnan", "Layla", "Noura", "Bilal"],
    last: ["Al Marri", "Al Nuaimi", "Al Suwaidi", "Al Fardan", "Haddad", "Rahimi", "Karimi", "Al Balushi", "Nasser"] },
  filipino: { first: ["Mark", "Joshua", "Jerome", "Rey", "Emmanuel", "Paolo", "Christian", "Dan", "Nico", "Kevin", "Angel", "Grace"],
    last: ["Santos", "Reyes", "Dela Cruz", "Bautista", "Villanueva", "Aquino", "Mendoza", "Ramos", "Castro", "Flores"] },
};

export const CITIES: Record<Region, string[]> = {
  anglo: ["Manchester", "Dublin", "Toronto", "Boston", "Glasgow", "Melbourne", "Denver", "Cardiff"],
  brazil: ["Rio de Janeiro", "São Paulo", "Curitiba", "Belém", "Fortaleza"],
  thai: ["Bangkok", "Phuket", "Chiang Mai", "Buriram", "Pattaya"],
  slavic: ["Moscow", "Kyiv", "Warsaw", "Dagestan", "Minsk", "Sofia"],
  japanese: ["Tokyo", "Osaka", "Saitama", "Nagoya"],
  hispanic: ["Mexico City", "Madrid", "Guadalajara", "Tijuana", "Buenos Aires"],
  gulf: ["Dubai", "Abu Dhabi", "Doha", "Riyadh"],
  filipino: ["Manila", "Cebu", "Baguio", "Davao"],
};

export const GYMS = [
  "Tiger Muay Thai", "American Top Team", "City Kickboxing", "AKA", "Jackson-Wink", "Tristar Gym",
  "Alliance BJJ", "Team Nogueira", "Evolve MMA", "SBG Ireland", "Kill Cliff FC", "Xtreme Couture",
  "Fortis MMA", "Sanford MMA", "Team Kaobon", "Renzo Gracie Academy", "10th Planet", "Elevation Fight Team",
  "MTK Global", "Sitmonchai", "Petchyindee", "Combat Club Dubai",
];

// ── Comment bank ────────────────────────────────────────────────────────────
// Slots filled at render time: {red} {blue} {fav} {dog} {winner} {loser}
// {method} {round} {sport} {gym}. Each tone has openers (start a thread branch),
// replies (respond to another post), and postResult (after a bout is decided).
export const COMMENT_BANKS: Record<Tone, { opener: string[]; reply: string[]; postResult: string[] }> = {
  casual: {
    opener: [
      "{fav} by whatever they want honestly. Not seeing how {dog} wins this.",
      "Been waiting for this one all camp. Taking {fav}, {method}.",
      "{red} vs {blue} is the only fight I care about on this card.",
      "gut says {dog} pulls the upset but my head says {fav} 🤷",
      "who's actually watching this live? {city} crew where you at",
    ],
    reply: [
      "yeah I can see that tbh",
      "nah you're overrating {dog}, {fav} is levels above",
      "lol calling it now, screenshot this",
      "this aged well or terribly, no in between",
      "respectfully hard disagree but I get it",
    ],
    postResult: [
      "CALLED IT. {winner} {method} 😤",
      "well that was not what I predicted 💀",
      "{winner} looked unreal. wow.",
      "knew {loser} was overhyped",
    ],
  },
  technical: {
    opener: [
      "Grappling exchanges decide this. {dog} has the better hips and top control — I've got the upset by {method}.",
      "Everyone sleeps on {dog}'s guard retention. If {red} shoots he's in trouble by round {round}.",
      "{fav} fades after round 2 historically. Cardio + level changes = {dog} in the championship rounds.",
      "Watch the underhook battle. Whoever wins the tie-up wins the fight, and that's {dog} for me.",
      "Southpaw vs orthodox, lead-hand dominance is everything here. Slight edge {fav} but it's a live dog.",
    ],
    reply: [
      "Disagree — {fav}'s scrambles are elite, he'll never be held down long enough for that.",
      "Finally someone who watches the hand-fighting and not just the finishes.",
      "The tape backs you up. {loser} got out-positioned every time he faced pressure.",
      "Good read but you're discounting the reach. {fav} controls distance and it never hits the mat.",
      "This is the correct breakdown. Rest of the thread is just picking names.",
    ],
    postResult: [
      "Exactly as drawn up — {winner} controlled the tie-ups and got it {method}.",
      "Told you the guard retention was real. {winner} by {method}, round {round}.",
      "Positional dominance on full display. Textbook.",
      "{loser}'s scrambles let him down under fatigue, just like the tape suggested.",
    ],
  },
  analyst: {
    opener: [
      "Tale of the tape favours {fav}, but the stylistic matchup is closer than the odds. Leaning {fav} on points.",
      "Key stat: {fav} lands at range but eats damage on entries. {dog} is a value play at these numbers.",
      "This is a chess match. Neither man wants to lead. I expect a tactical decision — {method} to the winner.",
      "The line moved toward {fav} all week. Sharp money usually knows something the casuals don't.",
      "Underrated angle: fight IQ. {dog} rarely makes the mistake that loses him a round.",
    ],
    reply: [
      "Solid analysis. The pace question is the whole fight for me.",
      "Agree on the value, but variance in {sport} makes any single bout a coin flip.",
      "The line movement point is doing a lot of work here — could just be public money on a name.",
      "Would add: judging in this promotion rewards aggression, which helps {fav}.",
      "This is the kind of breakdown the mainstream sites never write. Good stuff.",
    ],
    postResult: [
      "Result tracks the read: {winner} by {method}. The tactical patience paid off.",
      "Called the {method}. The pace was the difference, exactly as flagged.",
      "Good fight for the read, bad fight for the favourites-only crowd. {winner} deserved it.",
      "Scorecards will get debated but {winner} did enough on volume.",
    ],
  },
  hype: {
    opener: [
      "{red} vs {blue} is going to be an absolute WAR 🔥🔥 taking {fav} to get it done by {method}!!",
      "STYLES MAKE FIGHTS and this one is chaos. {dog} sleeps somebody I'm telling you.",
      "if {fav} lands clean it's over in round {round}. book it. 💥",
      "this is why we love the {sport} game. can't miss card. {fav} all day.",
      "the energy for this one is unreal. whole {gym} is picking {fav}.",
    ],
    reply: [
      "LETS GOOO finally someone with taste 🙌",
      "nah {dog} has the dawg in him, don't sleep",
      "round {round} KO you heard it here first",
      "this thread is COOKING 🔥",
      "put some respect on {dog}'s name man",
    ],
    postResult: [
      "WAAAR!! {winner} by {method} I TOLD YOU 🗣️🗣️",
      "that's why you never blink in {sport}. insane finish.",
      "{winner} is HIM. next title shot let's go",
      "robbery or not that was a FIGHT",
    ],
  },
  trashtalk: {
    opener: [
      "anyone taking {fav} hasn't watched a fight in their life. {dog} by {method}, easy.",
      "{fav} is the most overrated name in {sport} and this is the night it gets exposed.",
      "screenshot this: {dog} {method} round {round}. the casuals will cope.",
      "half this thread is going to be quiet after {dog} wins lmao",
      "{loser} fans really think they're winning this one 😂",
    ],
    reply: [
      "cope harder, {fav} gets clipped and you know it",
      "remindme after the fight, gonna enjoy this one",
      "weakest take in the thread and that's saying something",
      "you'll be deleting this later 💀",
      "the delusion is genuinely impressive",
    ],
    postResult: [
      "AS I SAID. {winner} {method}. where's everyone now? 😂",
      "told you {loser} was a fraud. pay up.",
      "quietest thread in the app right now, love to see it",
      "never bet against me in {sport} again",
    ],
  },
};

// A few plausible thread-starter titles beyond the auto event thread.
export const TOPIC_TITLES = [
  "Most underrated fighter in {sport} right now?",
  "Unpopular opinion: {sport} judging is broken",
  "Best gym in the world for {sport} — settle it",
  "Who's the scariest finisher in the game?",
  "Rank your top 5 pound-for-pound, go",
  "What got you into {sport}?",
  "Hardest skill to learn in {sport}, and why",
];

// Generic discussion for category / topic threads (no specific bout). Slots:
// {sport} {gym}. Keeps forum categories alive without inventing fake fights.
export const TOPIC_BANK = {
  opener: [
    "Hot take: {sport} is the most technical thing in combat sports and it's not close.",
    "Nobody talks about how deep the {sport} talent pool has gotten. Wild era to be a fan.",
    "The judging in {sport} has been genuinely bad lately. Someone tell me I'm wrong.",
    "Grappling saves lives. That's the post. {sport} heads already know.",
    "Gym culture matters more than genetics. {gym} is proof — change my mind.",
    "Who's the most underrated name outside the {sport} hardcore bubble?",
    "Footwork is 80% of {sport} and nobody drills it enough.",
  ],
  reply: [
    "Solid take. Coaching is the real difference-maker for me.",
    "Hard disagree, but I respect where you're coming from.",
    "This is exactly why I love {sport} — the nuance is unreal.",
    "Nah, the talent gap is closing fast, casuals just aren't watching.",
    "Say it louder. The judges have ended too many careers early.",
    "The {gym} crew is built different, can't argue that one.",
    "Come train and say that 😅 — respectfully.",
    "Been saying this for years and getting laughed at. Vindicated.",
  ],
};

// Discussion for a single fighter's thread. Slot {subject} = fighter name.
export const FIGHTER_BANK = {
  opener: [
    "{subject} is criminally underrated. Prime years happening right now.",
    "Rewatched every {subject} fight this week — the timing is on another level.",
    "{subject} vs anyone in the division and I'm taking {subject} every time.",
    "The way {subject} sets up the finish is basically chess. Elite fight IQ.",
    "Genuinely think {subject} is one bad matchup from being a superstar.",
  ],
  reply: [
    "Agree on the IQ, but the durability question is real.",
    "This. {subject} does the quiet things that win rounds.",
    "Overrating them a touch imo, but the ceiling is undeniable.",
    "The footwork alone is worth the price of admission.",
    "Give {subject} a title shot already, we've waited long enough.",
  ],
};
