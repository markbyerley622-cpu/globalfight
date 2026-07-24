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
// ISO-3166 alpha-3 → alpha-2 for the codes sources actually emit (UFC, sambo/
// wrestling feeds, etc.). Without this a "USA"/"BRA"/"GBR" rendered as a blank
// grey box on cards. Common aliases (UK, ENG…) fold in too.
const ALPHA3_TO_2: Record<string, string> = {
  usa: "us", gbr: "gb", uk: "gb", eng: "gb", sco: "gb", wal: "gb", nir: "gb",
  can: "ca", mex: "mx", bra: "br", arg: "ar", chi: "cl", col: "co", per: "pe",
  ven: "ve", ecu: "ec", uru: "uy", par: "py", bol: "bo", pan: "pa", cri: "cr",
  crc: "cr", cub: "cu", dom: "do", pur: "pr", nic: "ni", gua: "gt", hon: "hn",
  jpn: "jp", kor: "kr", chn: "cn", tha: "th", phi: "ph", vie: "vn", vnm: "vn",
  idn: "id", ina: "id", mys: "my", sgp: "sg", ind: "in", pak: "pk", kaz: "kz",
  uzb: "uz", kgz: "kg", tjk: "tj", mng: "mn", tur: "tr", geo: "ge", arm: "am",
  aze: "az", irn: "ir", iri: "ir", irq: "iq", isr: "il", ksa: "sa", uae: "ae",
  fra: "fr", ger: "de", deu: "de", esp: "es", ita: "it", ned: "nl", nld: "nl",
  bel: "be", por: "pt", prt: "pt", irl: "ie", sui: "ch", che: "ch", aut: "at",
  swe: "se", nor: "no", den: "dk", dnk: "dk", fin: "fi", pol: "pl", pol2: "pl",
  rou: "ro", hun: "hu", cze: "cz", svk: "sk", cro: "hr", hrv: "hr", srb: "rs",
  bul: "bg", bgr: "bg", gre: "gr", grc: "gr", ukr: "ua", rus: "ru", blr: "by",
  rsa: "za", zaf: "za", nga: "ng", ngr: "ng", gha: "gh", cmr: "cm", cgo: "cg",
  cod: "cd", ken: "ke", mar: "ma", mor: "ma", egy: "eg", tun: "tn", alg: "dz",
  dza: "dz", ang: "ao", sen: "sn", civ: "ci", gin: "gn", aus: "au", nzl: "nz",
};

export function toCountryCode(input?: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
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
  return NAME_TO_CODE[trimmed.toLowerCase()];
}
