// Country name → ISO-3166 alpha-2 resolution, shared across ingest + UI.
//
// Data sources hand us country *names* (Wikipedia rosters, API providers,
// the odds/event APIs) but the <Flag> component needs a 2-letter code for
// flagcdn. Centralise the mapping here so flags resolve consistently whether
// the stored value is already a code ("US") or a full name ("United States").

const NAME_TO_CODE: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", "u.s.a.": "US", "u.s.": "US", america: "US",
  "united kingdom": "GB", uk: "GB", "u.k.": "GB", "great britain": "GB", britain: "GB",
  england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  ireland: "IE", brazil: "BR", russia: "RU", "russian federation": "RU", dagestan: "RU",
  canada: "CA", mexico: "MX", australia: "AU", "new zealand": "NZ", france: "FR", germany: "DE",
  poland: "PL", sweden: "SE", netherlands: "NL", holland: "NL", spain: "ES", italy: "IT",
  georgia: "GE", armenia: "AM", azerbaijan: "AZ", kazakhstan: "KZ", kyrgyzstan: "KG", uzbekistan: "UZ", tajikistan: "TJ",
  china: "CN", japan: "JP", "south korea": "KR", korea: "KR", "north korea": "KP",
  thailand: "TH", philippines: "PH", vietnam: "VN", malaysia: "MY", "hong kong": "HK", taiwan: "TW",
  "united arab emirates": "AE", uae: "AE", "saudi arabia": "SA", qatar: "QA", kuwait: "KW", bahrain: "BH", oman: "OM",
  "south africa": "ZA", nigeria: "NG", cameroon: "CM", ghana: "GH", kenya: "KE", morocco: "MA", egypt: "EG", senegal: "SN", "ivory coast": "CI", congo: "CD",
  argentina: "AR", chile: "CL", peru: "PE", ecuador: "EC", cuba: "CU", uruguay: "UY", paraguay: "PY", bolivia: "BO",
  colombia: "CO", venezuela: "VE", "dominican republic": "DO", "puerto rico": "PR", panama: "PA", "costa rica": "CR", nicaragua: "NI", honduras: "HN", guatemala: "GT", "el salvador": "SV",
  "czech republic": "CZ", czechia: "CZ", slovakia: "SK", croatia: "HR", slovenia: "SI", serbia: "RS", "bosnia and herzegovina": "BA", "north macedonia": "MK", montenegro: "ME", albania: "AL", kosovo: "XK",
  norway: "NO", denmark: "DK", finland: "FI", iceland: "IS", austria: "AT", switzerland: "CH", belgium: "BE", luxembourg: "LU",
  portugal: "PT", greece: "GR", cyprus: "CY", malta: "MT",
  ukraine: "UA", belarus: "BY", moldova: "MD", romania: "RO", bulgaria: "BG", hungary: "HU", lithuania: "LT", latvia: "LV", estonia: "EE",
  turkey: "TR", "türkiye": "TR", iran: "IR", iraq: "IQ", israel: "IL", lebanon: "LB", jordan: "JO", syria: "SY", afghanistan: "AF", pakistan: "PK",
  india: "IN", "sri lanka": "LK", bangladesh: "BD", nepal: "NP", indonesia: "ID", singapore: "SG", myanmar: "MM", cambodia: "KH", laos: "LA",
  suriname: "SR", jamaica: "JM", "trinidad and tobago": "TT", bahamas: "BS", barbados: "BB", guyana: "GY",
};

/**
 * Resolve a country code or name to a lowercase ISO-3166 alpha-2 code for
 * flagcdn. Accepts an existing 2-letter code (returned as-is), a full country
 * name, or common aliases (USA, UK, England…). Returns undefined when unknown
 * so callers can fall back to no flag.
 */
// COMPLETE ISO-3166-1 alpha-3 → alpha-2. The whole table, not a hand-picked
// subset — so ANY 3-letter code a source emits resolves, forever. (My earlier
// partial list got URY wrong and missed MDA/TKM; this is the canonical set.)
const ALPHA3_TO_2: Record<string, string> = {
  abw: "aw", afg: "af", ago: "ao", aia: "ai", ala: "ax", alb: "al", and: "ad",
  are: "ae", arg: "ar", arm: "am", asm: "as", ata: "aq", atf: "tf", atg: "ag",
  aus: "au", aut: "at", aze: "az", bdi: "bi", bel: "be", ben: "bj", bes: "bq",
  bfa: "bf", bgd: "bd", bgr: "bg", bhr: "bh", bhs: "bs", bih: "ba", blm: "bl",
  blr: "by", blz: "bz", bmu: "bm", bol: "bo", bra: "br", brb: "bb", brn: "bn",
  btn: "bt", bvt: "bv", bwa: "bw", caf: "cf", can: "ca", cck: "cc", che: "ch",
  chl: "cl", chn: "cn", civ: "ci", cmr: "cm", cod: "cd", cog: "cg", cok: "ck",
  col: "co", com: "km", cpv: "cv", cri: "cr", cub: "cu", cuw: "cw", cxr: "cx",
  cym: "ky", cyp: "cy", cze: "cz", deu: "de", dji: "dj", dma: "dm", dnk: "dk",
  dom: "do", dza: "dz", ecu: "ec", egy: "eg", eri: "er", esh: "eh", esp: "es",
  est: "ee", eth: "et", fin: "fi", fji: "fj", flk: "fk", fra: "fr", fro: "fo",
  fsm: "fm", gab: "ga", gbr: "gb", geo: "ge", ggy: "gg", gha: "gh", gib: "gi",
  gin: "gn", glp: "gp", gmb: "gm", gnb: "gw", gnq: "gq", grc: "gr", grd: "gd",
  grl: "gl", gtm: "gt", guf: "gf", gum: "gu", guy: "gy", hkg: "hk", hmd: "hm",
  hnd: "hn", hrv: "hr", hti: "ht", hun: "hu", idn: "id", imn: "im", ind: "in",
  iot: "io", irl: "ie", irn: "ir", irq: "iq", isl: "is", isr: "il", ita: "it",
  jam: "jm", jey: "je", jor: "jo", jpn: "jp", kaz: "kz", ken: "ke", kgz: "kg",
  khm: "kh", kir: "ki", kna: "kn", kor: "kr", kwt: "kw", lao: "la", lbn: "lb",
  lbr: "lr", lby: "ly", lca: "lc", lie: "li", lka: "lk", lso: "ls", ltu: "lt",
  lux: "lu", lva: "lv", mac: "mo", maf: "mf", mar: "ma", mco: "mc", mda: "md",
  mdg: "mg", mdv: "mv", mex: "mx", mhl: "mh", mkd: "mk", mli: "ml", mlt: "mt",
  mmr: "mm", mne: "me", mng: "mn", mnp: "mp", moz: "mz", mrt: "mr", msr: "ms",
  mtq: "mq", mus: "mu", mwi: "mw", mys: "my", myt: "yt", nam: "na", ncl: "nc",
  ner: "ne", nfk: "nf", nga: "ng", nic: "ni", niu: "nu", nld: "nl", nor: "no",
  npl: "np", nru: "nr", nzl: "nz", omn: "om", pak: "pk", pan: "pa", pcn: "pn",
  per: "pe", phl: "ph", plw: "pw", png: "pg", pol: "pl", pri: "pr", prk: "kp",
  prt: "pt", pry: "py", pse: "ps", pyf: "pf", qat: "qa", reu: "re", rou: "ro",
  rus: "ru", rwa: "rw", sau: "sa", sdn: "sd", sen: "sn", sgp: "sg", sgs: "gs",
  shn: "sh", sjm: "sj", slb: "sb", sle: "sl", slv: "sv", smr: "sm", som: "so",
  spm: "pm", srb: "rs", ssd: "ss", stp: "st", sur: "sr", svk: "sk", svn: "si",
  swe: "se", swz: "sz", sxm: "sx", syc: "sc", syr: "sy", tca: "tc", tcd: "td",
  tgo: "tg", tha: "th", tjk: "tj", tkl: "tk", tkm: "tm", tls: "tl", ton: "to",
  tto: "tt", tun: "tn", tur: "tr", tuv: "tv", twn: "tw", tza: "tz", uga: "ug",
  ukr: "ua", umi: "um", ury: "uy", usa: "us", uzb: "uz", vat: "va", vct: "vc",
  ven: "ve", vgb: "vg", vir: "vi", vnm: "vn", vut: "vu", wlf: "wf", wsm: "ws",
  yem: "ye", zaf: "za", zmb: "zm", zwe: "zw",
  // Non-ISO federation/sport codes commonly seen in combat-sports feeds.
  uk: "gb", eng: "gb", sco: "gb", wal: "gb", nir: "gb", ger: "de", ned: "nl",
  sui: "ch", den: "dk", por: "pt", cro: "hr", gre: "gr", rsa: "za", ina: "id",
  iri: "ir", ksa: "sa", uae: "ae", tpe: "tw", roc: "ru", bul: "bg", lat: "lv",
  slo: "si", mas: "my", mgl: "mn", kuw: "kw", bah: "bs", pur: "pr", crc: "cr",
};

export function toCountryCode(input?: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  // Always return a lowercase ISO-2 (flagcdn's path is case-sensitive).
  // Already a 2-letter code (e.g. "US", "gb"). "uk" → "gb" for flagcdn.
  if (/^[a-zA-Z]{2}$/.test(trimmed)) {
    const two = trimmed.toLowerCase();
    return two === "uk" ? "gb" : two;
  }
  // 3-letter alpha-3 (USA, BRA, GBR…).
  if (/^[a-zA-Z]{3}$/.test(trimmed)) {
    const three = ALPHA3_TO_2[trimmed.toLowerCase()];
    if (three) return three;
  }
  const name = trimmed.toLowerCase();
  const hit = NAME_TO_CODE[name]
    // Official long forms: "Republic of Moldova", "The Gambia", "State of Qatar".
    ?? NAME_TO_CODE[name.replace(/^(the |republic of |kingdom of |state of |federal |bolivarian |islamic )+/g, "").replace(/,.*$/, "").trim()];
  return hit?.toLowerCase();
}
