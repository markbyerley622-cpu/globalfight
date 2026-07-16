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
export function toCountryCode(input?: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  // Already a 2-letter code (e.g. "US", "gb").
  if (/^[a-zA-Z]{2}$/.test(trimmed)) return trimmed.toLowerCase();
  return NAME_TO_CODE[trimmed.toLowerCase()];
}
