// ════════════════════════════════════════════════════════════════════════════
//  Gazetteer — city / country → coordinates.
//
//  The Event table stores `venue`, `city`, `country` and `countryCode` as text;
//  it has NO latitude/longitude column. Rather than add a migration and a
//  geocoding vendor before the map has proven itself, the Location pillar
//  resolves coordinates from this table at query time.
//
//  Two consequences worth being explicit about, because they show in the UI:
//
//    · A city hit is accurate to the CITY, never the building. The map says so
//      ("city centre") and the Directions action searches the venue by name
//      rather than dropping a false pin on a street corner.
//    · A country-only hit is accurate to the COUNTRY. Those pins are labelled
//      "approx." and sort below city hits.
//
//  When real venue coordinates arrive (a geocoding pass writing Event.latitude /
//  Event.longitude), `resolvePoint()` is the single place that changes: prefer
//  the column, fall back to here. Nothing else in the map stack moves.
//
//  Coverage is intentionally combat-sports-shaped — the cities that actually
//  host cards — not a general-purpose world gazetteer.
// ════════════════════════════════════════════════════════════════════════════

export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * How precisely a pin was located. Drives the UI's honesty labels.
 *
 * `exact` is only ever set from a stored latitude/longitude column (a gym's
 * real address). Nothing in this file can produce it — the gazetteer's best
 * answer is a city.
 */
export type GeoPrecision = "exact" | "city" | "country";

export interface ResolvedPoint extends GeoPoint {
  precision: GeoPrecision;
}

/** Normalise a place name for lookup: lowercase, strip accents/punctuation. */
function key(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ── Cities ────────────────────────────────────────────────────────────────
// Keyed "city|CC" where possible so "Birmingham|US" and "Birmingham|GB" stay
// distinct. A bare city key is the fallback when the event has no country code.
const CITIES: Record<string, GeoPoint> = {
  // ── United States ──
  "las vegas|us": { lat: 36.1699, lon: -115.1398 },
  "new york|us": { lat: 40.7128, lon: -74.006 },
  "brooklyn|us": { lat: 40.6782, lon: -73.9442 },
  "newark|us": { lat: 40.7357, lon: -74.1724 },
  "los angeles|us": { lat: 34.0522, lon: -118.2437 },
  "inglewood|us": { lat: 33.9617, lon: -118.3531 },
  "anaheim|us": { lat: 33.8366, lon: -117.9143 },
  "san diego|us": { lat: 32.7157, lon: -117.1611 },
  "san jose|us": { lat: 37.3382, lon: -121.8863 },
  "san francisco|us": { lat: 37.7749, lon: -122.4194 },
  "oakland|us": { lat: 37.8044, lon: -122.2712 },
  "sacramento|us": { lat: 38.5816, lon: -121.4944 },
  "fresno|us": { lat: 36.7378, lon: -119.7871 },
  "phoenix|us": { lat: 33.4484, lon: -112.074 },
  "glendale|us": { lat: 33.5387, lon: -112.186 },
  "tucson|us": { lat: 32.2226, lon: -110.9747 },
  "denver|us": { lat: 39.7392, lon: -104.9903 },
  "salt lake city|us": { lat: 40.7608, lon: -111.891 },
  "albuquerque|us": { lat: 35.0844, lon: -106.6504 },
  "dallas|us": { lat: 32.7767, lon: -96.797 },
  "arlington|us": { lat: 32.7357, lon: -97.1081 },
  "fort worth|us": { lat: 32.7555, lon: -97.3308 },
  "houston|us": { lat: 29.7604, lon: -95.3698 },
  "austin|us": { lat: 30.2672, lon: -97.7431 },
  "san antonio|us": { lat: 29.4241, lon: -98.4936 },
  "el paso|us": { lat: 31.7619, lon: -106.485 },
  "chicago|us": { lat: 41.8781, lon: -87.6298 },
  "detroit|us": { lat: 42.3314, lon: -83.0458 },
  "cleveland|us": { lat: 41.4993, lon: -81.6944 },
  "columbus|us": { lat: 39.9612, lon: -82.9988 },
  "cincinnati|us": { lat: 39.1031, lon: -84.512 },
  "indianapolis|us": { lat: 39.7684, lon: -86.1581 },
  "milwaukee|us": { lat: 43.0389, lon: -87.9065 },
  "minneapolis|us": { lat: 44.9778, lon: -93.265 },
  "st louis|us": { lat: 38.627, lon: -90.1994 },
  "kansas city|us": { lat: 39.0997, lon: -94.5786 },
  "omaha|us": { lat: 41.2565, lon: -95.9345 },
  "nashville|us": { lat: 36.1627, lon: -86.7816 },
  "memphis|us": { lat: 35.1495, lon: -90.049 },
  "louisville|us": { lat: 38.2527, lon: -85.7585 },
  "atlanta|us": { lat: 33.749, lon: -84.388 },
  "charlotte|us": { lat: 35.2271, lon: -80.8431 },
  "raleigh|us": { lat: 35.7796, lon: -78.6382 },
  "miami|us": { lat: 25.7617, lon: -80.1918 },
  "orlando|us": { lat: 28.5383, lon: -81.3792 },
  "tampa|us": { lat: 27.9506, lon: -82.4572 },
  "jacksonville|us": { lat: 30.3322, lon: -81.6557 },
  "hollywood|us": { lat: 26.0112, lon: -80.1495 },
  "sunrise|us": { lat: 26.1337, lon: -80.2706 },
  "new orleans|us": { lat: 29.9511, lon: -90.0715 },
  "philadelphia|us": { lat: 39.9526, lon: -75.1652 },
  "pittsburgh|us": { lat: 40.4406, lon: -79.9959 },
  "boston|us": { lat: 42.3601, lon: -71.0589 },
  "washington|us": { lat: 38.9072, lon: -77.0369 },
  "baltimore|us": { lat: 39.2904, lon: -76.6122 },
  "atlantic city|us": { lat: 39.3643, lon: -74.4229 },
  "uncasville|us": { lat: 41.4362, lon: -72.0959 },
  "seattle|us": { lat: 47.6062, lon: -122.3321 },
  "portland|us": { lat: 45.5152, lon: -122.6784 },
  "honolulu|us": { lat: 21.3069, lon: -157.8583 },
  "biloxi|us": { lat: 30.396, lon: -88.8853 },
  "tulsa|us": { lat: 36.154, lon: -95.9928 },
  "oklahoma city|us": { lat: 35.4676, lon: -97.5164 },
  "boise|us": { lat: 43.615, lon: -116.2023 },
  "wichita|us": { lat: 37.6872, lon: -97.3301 },
  "des moines|us": { lat: 41.5868, lon: -93.625 },

  // ── Canada ──
  "toronto|ca": { lat: 43.6532, lon: -79.3832 },
  "montreal|ca": { lat: 45.5019, lon: -73.5674 },
  "vancouver|ca": { lat: 49.2827, lon: -123.1207 },
  "calgary|ca": { lat: 51.0447, lon: -114.0719 },
  "edmonton|ca": { lat: 53.5461, lon: -113.4938 },
  "ottawa|ca": { lat: 45.4215, lon: -75.6972 },
  "winnipeg|ca": { lat: 49.8951, lon: -97.1384 },
  "halifax|ca": { lat: 44.6488, lon: -63.5752 },
  "quebec city|ca": { lat: 46.8139, lon: -71.208 },

  // ── Mexico / LatAm ──
  "mexico city|mx": { lat: 19.4326, lon: -99.1332 },
  "guadalajara|mx": { lat: 20.6597, lon: -103.3496 },
  "monterrey|mx": { lat: 25.6866, lon: -100.3161 },
  "tijuana|mx": { lat: 32.5149, lon: -117.0382 },
  "cancun|mx": { lat: 21.1619, lon: -86.8515 },
  "sao paulo|br": { lat: -23.5505, lon: -46.6333 },
  "rio de janeiro|br": { lat: -22.9068, lon: -43.1729 },
  "brasilia|br": { lat: -15.7939, lon: -47.8828 },
  "curitiba|br": { lat: -25.4284, lon: -49.2733 },
  "belo horizonte|br": { lat: -19.9167, lon: -43.9345 },
  "fortaleza|br": { lat: -3.7319, lon: -38.5267 },
  "porto alegre|br": { lat: -30.0346, lon: -51.2177 },
  "buenos aires|ar": { lat: -34.6037, lon: -58.3816 },
  "santiago|cl": { lat: -33.4489, lon: -70.6693 },
  "lima|pe": { lat: -12.0464, lon: -77.0428 },
  "bogota|co": { lat: 4.711, lon: -74.0721 },
  "medellin|co": { lat: 6.2476, lon: -75.5658 },
  "panama city|pa": { lat: 8.9824, lon: -79.5199 },
  "san juan|pr": { lat: 18.4655, lon: -66.1057 },
  "havana|cu": { lat: 23.1136, lon: -82.3666 },
  "kingston|jm": { lat: 17.9714, lon: -76.7936 },
  "montevideo|uy": { lat: -34.9011, lon: -56.1645 },

  // ── United Kingdom & Ireland ──
  "london|gb": { lat: 51.5074, lon: -0.1278 },
  "manchester|gb": { lat: 53.4808, lon: -2.2426 },
  "liverpool|gb": { lat: 53.4084, lon: -2.9916 },
  "birmingham|gb": { lat: 52.4862, lon: -1.8904 },
  "leeds|gb": { lat: 53.8008, lon: -1.5491 },
  "sheffield|gb": { lat: 53.3811, lon: -1.4701 },
  "newcastle|gb": { lat: 54.9783, lon: -1.6178 },
  "nottingham|gb": { lat: 52.9548, lon: -1.1581 },
  "cardiff|gb": { lat: 51.4816, lon: -3.1791 },
  "glasgow|gb": { lat: 55.8642, lon: -4.2518 },
  "edinburgh|gb": { lat: 55.9533, lon: -3.1883 },
  "belfast|gb": { lat: 54.5973, lon: -5.9301 },
  "bolton|gb": { lat: 53.578, lon: -2.4283 },
  "brighton|gb": { lat: 50.8225, lon: -0.1372 },
  "dublin|ie": { lat: 53.3498, lon: -6.2603 },

  // ── Europe ──
  "paris|fr": { lat: 48.8566, lon: 2.3522 },
  "lyon|fr": { lat: 45.764, lon: 4.8357 },
  "marseille|fr": { lat: 43.2965, lon: 5.3698 },
  "nantes|fr": { lat: 47.2184, lon: -1.5536 },
  "berlin|de": { lat: 52.52, lon: 13.405 },
  "hamburg|de": { lat: 53.5511, lon: 9.9937 },
  "munich|de": { lat: 48.1351, lon: 11.582 },
  "cologne|de": { lat: 50.9375, lon: 6.9603 },
  "frankfurt|de": { lat: 50.1109, lon: 8.6821 },
  "dusseldorf|de": { lat: 51.2277, lon: 6.7735 },
  "stuttgart|de": { lat: 48.7758, lon: 9.1829 },
  "oberhausen|de": { lat: 51.4963, lon: 6.8638 },
  "amsterdam|nl": { lat: 52.3676, lon: 4.9041 },
  "rotterdam|nl": { lat: 51.9244, lon: 4.4777 },
  "arnhem|nl": { lat: 51.9851, lon: 5.8987 },
  "brussels|be": { lat: 50.8503, lon: 4.3517 },
  "antwerp|be": { lat: 51.2194, lon: 4.4025 },
  "madrid|es": { lat: 40.4168, lon: -3.7038 },
  "barcelona|es": { lat: 41.3851, lon: 2.1734 },
  "valencia|es": { lat: 39.4699, lon: -0.3763 },
  "lisbon|pt": { lat: 38.7223, lon: -9.1393 },
  "porto|pt": { lat: 41.1579, lon: -8.6291 },
  "rome|it": { lat: 41.9028, lon: 12.4964 },
  "milan|it": { lat: 45.4642, lon: 9.19 },
  "turin|it": { lat: 45.0703, lon: 7.6869 },
  "naples|it": { lat: 40.8518, lon: 14.2681 },
  "zurich|ch": { lat: 47.3769, lon: 8.5417 },
  "geneva|ch": { lat: 46.2044, lon: 6.1432 },
  "vienna|at": { lat: 48.2082, lon: 16.3738 },
  "prague|cz": { lat: 50.0755, lon: 14.4378 },
  "brno|cz": { lat: 49.1951, lon: 16.6068 },
  "ostrava|cz": { lat: 49.8209, lon: 18.2625 },
  "warsaw|pl": { lat: 52.2297, lon: 21.0122 },
  "krakow|pl": { lat: 50.0647, lon: 19.945 },
  "gdansk|pl": { lat: 54.352, lon: 18.6466 },
  "lodz|pl": { lat: 51.7592, lon: 19.4559 },
  "wroclaw|pl": { lat: 51.1079, lon: 17.0385 },
  "budapest|hu": { lat: 47.4979, lon: 19.0402 },
  "bucharest|ro": { lat: 44.4268, lon: 26.1025 },
  "sofia|bg": { lat: 42.6977, lon: 23.3219 },
  "belgrade|rs": { lat: 44.7866, lon: 20.4489 },
  "zagreb|hr": { lat: 45.815, lon: 15.9819 },
  "ljubljana|si": { lat: 46.0569, lon: 14.5058 },
  "bratislava|sk": { lat: 48.1486, lon: 17.1077 },
  "athens|gr": { lat: 37.9838, lon: 23.7275 },
  "stockholm|se": { lat: 59.3293, lon: 18.0686 },
  "gothenburg|se": { lat: 57.7089, lon: 11.9746 },
  "oslo|no": { lat: 59.9139, lon: 10.7522 },
  "copenhagen|dk": { lat: 55.6761, lon: 12.5683 },
  "helsinki|fi": { lat: 60.1699, lon: 24.9384 },
  "reykjavik|is": { lat: 64.1466, lon: -21.9426 },
  "tallinn|ee": { lat: 59.437, lon: 24.7536 },
  "riga|lv": { lat: 56.9496, lon: 24.1052 },
  "vilnius|lt": { lat: 54.6872, lon: 25.2797 },
  "kyiv|ua": { lat: 50.4501, lon: 30.5234 },
  "moscow|ru": { lat: 55.7558, lon: 37.6173 },
  "saint petersburg|ru": { lat: 59.9311, lon: 30.3609 },
  "sochi|ru": { lat: 43.6028, lon: 39.7342 },
  "kazan|ru": { lat: 55.7887, lon: 49.1221 },
  "grozny|ru": { lat: 43.3169, lon: 45.6981 },
  "minsk|by": { lat: 53.9006, lon: 27.559 },
  "istanbul|tr": { lat: 41.0082, lon: 28.9784 },
  "ankara|tr": { lat: 39.9334, lon: 32.8597 },

  // ── Middle East ──
  "abu dhabi|ae": { lat: 24.4539, lon: 54.3773 },
  "dubai|ae": { lat: 25.2048, lon: 55.2708 },
  "riyadh|sa": { lat: 24.7136, lon: 46.6753 },
  "jeddah|sa": { lat: 21.4858, lon: 39.1925 },
  "diriyah|sa": { lat: 24.7376, lon: 46.5757 },
  "doha|qa": { lat: 25.2854, lon: 51.531 },
  "kuwait city|kw": { lat: 29.3759, lon: 47.9774 },
  "manama|bh": { lat: 26.2285, lon: 50.586 },
  "tel aviv|il": { lat: 32.0853, lon: 34.7818 },
  "amman|jo": { lat: 31.9454, lon: 35.9284 },
  "beirut|lb": { lat: 33.8938, lon: 35.5018 },
  "cairo|eg": { lat: 30.0444, lon: 31.2357 },

  // ── Africa ──
  "johannesburg|za": { lat: -26.2041, lon: 28.0473 },
  "cape town|za": { lat: -33.9249, lon: 18.4241 },
  "durban|za": { lat: -29.8587, lon: 31.0218 },
  "lagos|ng": { lat: 6.5244, lon: 3.3792 },
  "nairobi|ke": { lat: -1.2921, lon: 36.8219 },
  "accra|gh": { lat: 5.6037, lon: -0.187 },
  "casablanca|ma": { lat: 33.5731, lon: -7.5898 },
  "marrakesh|ma": { lat: 31.6295, lon: -7.9811 },
  "kinshasa|cd": { lat: -4.4419, lon: 15.2663 },

  // ── Asia ──
  "tokyo|jp": { lat: 35.6762, lon: 139.6503 },
  "saitama|jp": { lat: 35.8617, lon: 139.6455 },
  "yokohama|jp": { lat: 35.4437, lon: 139.638 },
  "osaka|jp": { lat: 34.6937, lon: 135.5023 },
  "nagoya|jp": { lat: 35.1815, lon: 136.9066 },
  "fukuoka|jp": { lat: 33.5904, lon: 130.4017 },
  "sapporo|jp": { lat: 43.0618, lon: 141.3545 },
  "seoul|kr": { lat: 37.5665, lon: 126.978 },
  "busan|kr": { lat: 35.1796, lon: 129.0756 },
  "beijing|cn": { lat: 39.9042, lon: 116.4074 },
  "shanghai|cn": { lat: 31.2304, lon: 121.4737 },
  "shenzhen|cn": { lat: 22.5431, lon: 114.0579 },
  "chengdu|cn": { lat: 30.5728, lon: 104.0668 },
  "macau|mo": { lat: 22.1987, lon: 113.5439 },
  "hong kong|hk": { lat: 22.3193, lon: 114.1694 },
  "taipei|tw": { lat: 25.033, lon: 121.5654 },
  "bangkok|th": { lat: 13.7563, lon: 100.5018 },
  "phuket|th": { lat: 7.8804, lon: 98.3923 },
  "chiang mai|th": { lat: 18.7883, lon: 98.9853 },
  "pattaya|th": { lat: 12.9236, lon: 100.8825 },
  "singapore|sg": { lat: 1.3521, lon: 103.8198 },
  "kuala lumpur|my": { lat: 3.139, lon: 101.6869 },
  "jakarta|id": { lat: -6.2088, lon: 106.8456 },
  "bali|id": { lat: -8.4095, lon: 115.1889 },
  "manila|ph": { lat: 14.5995, lon: 120.9842 },
  "quezon city|ph": { lat: 14.676, lon: 121.0437 },
  "ho chi minh city|vn": { lat: 10.8231, lon: 106.6297 },
  "hanoi|vn": { lat: 21.0278, lon: 105.8342 },
  "phnom penh|kh": { lat: 11.5564, lon: 104.9282 },
  "yangon|mm": { lat: 16.8409, lon: 96.1735 },
  "mumbai|in": { lat: 19.076, lon: 72.8777 },
  "new delhi|in": { lat: 28.6139, lon: 77.209 },
  "bengaluru|in": { lat: 12.9716, lon: 77.5946 },
  "hyderabad|in": { lat: 17.385, lon: 78.4867 },
  "almaty|kz": { lat: 43.222, lon: 76.8512 },
  "astana|kz": { lat: 51.1694, lon: 71.4491 },
  "bishkek|kg": { lat: 42.8746, lon: 74.5698 },
  "tashkent|uz": { lat: 41.2995, lon: 69.2401 },
  "baku|az": { lat: 40.4093, lon: 49.8671 },
  "tbilisi|ge": { lat: 41.7151, lon: 44.8271 },
  "yerevan|am": { lat: 40.1792, lon: 44.4991 },

  // ── Oceania ──
  "sydney|au": { lat: -33.8688, lon: 151.2093 },
  "melbourne|au": { lat: -37.8136, lon: 144.9631 },
  "brisbane|au": { lat: -27.4698, lon: 153.0251 },
  "perth|au": { lat: -31.9505, lon: 115.8605 },
  "adelaide|au": { lat: -34.9285, lon: 138.6007 },
  "gold coast|au": { lat: -28.0167, lon: 153.4 },
  "auckland|nz": { lat: -36.8485, lon: 174.7633 },
  "christchurch|nz": { lat: -43.5321, lon: 172.6362 },
  "wellington|nz": { lat: -41.2866, lon: 174.7756 },
  "suva|fj": { lat: -18.1416, lon: 178.4419 },
};

// ── Country centroids ─────────────────────────────────────────────────────
// Used only when the city is unknown. Pins built from these are labelled
// "approx." in the UI — they locate a country, not a venue.
const COUNTRIES: Record<string, GeoPoint> = {
  US: { lat: 39.5, lon: -98.35 },
  CA: { lat: 56.13, lon: -106.35 },
  MX: { lat: 23.63, lon: -102.55 },
  BR: { lat: -14.24, lon: -51.93 },
  AR: { lat: -38.42, lon: -63.62 },
  CL: { lat: -35.68, lon: -71.54 },
  PE: { lat: -9.19, lon: -75.02 },
  CO: { lat: 4.57, lon: -74.3 },
  UY: { lat: -32.52, lon: -55.77 },
  PA: { lat: 8.54, lon: -80.78 },
  CU: { lat: 21.52, lon: -77.78 },
  JM: { lat: 18.11, lon: -77.3 },
  PR: { lat: 18.22, lon: -66.59 },
  DO: { lat: 18.74, lon: -70.16 },
  GB: { lat: 54.0, lon: -2.0 },
  IE: { lat: 53.41, lon: -8.24 },
  FR: { lat: 46.6, lon: 2.21 },
  DE: { lat: 51.17, lon: 10.45 },
  NL: { lat: 52.13, lon: 5.29 },
  BE: { lat: 50.5, lon: 4.47 },
  ES: { lat: 40.46, lon: -3.75 },
  PT: { lat: 39.4, lon: -8.22 },
  IT: { lat: 41.87, lon: 12.57 },
  CH: { lat: 46.82, lon: 8.23 },
  AT: { lat: 47.52, lon: 14.55 },
  CZ: { lat: 49.82, lon: 15.47 },
  PL: { lat: 51.92, lon: 19.15 },
  HU: { lat: 47.16, lon: 19.5 },
  RO: { lat: 45.94, lon: 24.97 },
  BG: { lat: 42.73, lon: 25.49 },
  RS: { lat: 44.02, lon: 21.01 },
  HR: { lat: 45.1, lon: 15.2 },
  SI: { lat: 46.15, lon: 14.99 },
  SK: { lat: 48.67, lon: 19.7 },
  GR: { lat: 39.07, lon: 21.82 },
  SE: { lat: 60.13, lon: 18.64 },
  NO: { lat: 60.47, lon: 8.47 },
  DK: { lat: 56.26, lon: 9.5 },
  FI: { lat: 61.92, lon: 25.75 },
  IS: { lat: 64.96, lon: -19.02 },
  EE: { lat: 58.6, lon: 25.01 },
  LV: { lat: 56.88, lon: 24.6 },
  LT: { lat: 55.17, lon: 23.88 },
  UA: { lat: 48.38, lon: 31.17 },
  RU: { lat: 55.75, lon: 45.0 },
  BY: { lat: 53.71, lon: 27.95 },
  TR: { lat: 38.96, lon: 35.24 },
  AE: { lat: 24.45, lon: 54.38 },
  SA: { lat: 23.89, lon: 45.08 },
  QA: { lat: 25.35, lon: 51.18 },
  KW: { lat: 29.31, lon: 47.48 },
  BH: { lat: 26.07, lon: 50.56 },
  OM: { lat: 21.51, lon: 55.92 },
  IL: { lat: 31.05, lon: 34.85 },
  JO: { lat: 30.59, lon: 36.24 },
  LB: { lat: 33.85, lon: 35.86 },
  EG: { lat: 26.82, lon: 30.8 },
  ZA: { lat: -30.56, lon: 22.94 },
  NG: { lat: 9.08, lon: 8.68 },
  KE: { lat: -0.02, lon: 37.91 },
  GH: { lat: 7.95, lon: -1.02 },
  MA: { lat: 31.79, lon: -7.09 },
  CM: { lat: 7.37, lon: 12.35 },
  CD: { lat: -4.04, lon: 21.76 },
  SN: { lat: 14.5, lon: -14.45 },
  JP: { lat: 36.2, lon: 138.25 },
  KR: { lat: 35.91, lon: 127.77 },
  CN: { lat: 35.86, lon: 104.2 },
  HK: { lat: 22.32, lon: 114.17 },
  MO: { lat: 22.2, lon: 113.54 },
  TW: { lat: 23.7, lon: 120.96 },
  TH: { lat: 15.87, lon: 100.99 },
  SG: { lat: 1.35, lon: 103.82 },
  MY: { lat: 4.21, lon: 101.98 },
  ID: { lat: -0.79, lon: 113.92 },
  PH: { lat: 12.88, lon: 121.77 },
  VN: { lat: 14.06, lon: 108.28 },
  KH: { lat: 12.57, lon: 104.99 },
  MM: { lat: 21.91, lon: 95.96 },
  IN: { lat: 20.59, lon: 78.96 },
  PK: { lat: 30.38, lon: 69.35 },
  KZ: { lat: 48.02, lon: 66.92 },
  KG: { lat: 41.2, lon: 74.77 },
  UZ: { lat: 41.38, lon: 64.59 },
  AZ: { lat: 40.14, lon: 47.58 },
  GE: { lat: 42.32, lon: 43.36 },
  AM: { lat: 40.07, lon: 45.04 },
  IR: { lat: 32.43, lon: 53.69 },
  AU: { lat: -25.27, lon: 133.78 },
  NZ: { lat: -40.9, lon: 174.89 },
  FJ: { lat: -17.71, lon: 178.07 },
};

/** Country-name → ISO code, for rows that carry `country` but no `countryCode`. */
const COUNTRY_NAMES: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", "u s a": "US",
  canada: "CA", mexico: "MX", brazil: "BR", argentina: "AR", chile: "CL", peru: "PE",
  colombia: "CO", uruguay: "UY", panama: "PA", cuba: "CU", jamaica: "JM",
  "puerto rico": "PR", "dominican republic": "DO",
  "united kingdom": "GB", england: "GB", scotland: "GB", wales: "GB",
  "northern ireland": "GB", uk: "GB", ireland: "IE",
  france: "FR", germany: "DE", netherlands: "NL", holland: "NL", belgium: "BE",
  spain: "ES", portugal: "PT", italy: "IT", switzerland: "CH", austria: "AT",
  "czech republic": "CZ", czechia: "CZ", poland: "PL", hungary: "HU", romania: "RO",
  bulgaria: "BG", serbia: "RS", croatia: "HR", slovenia: "SI", slovakia: "SK",
  greece: "GR", sweden: "SE", norway: "NO", denmark: "DK", finland: "FI",
  iceland: "IS", estonia: "EE", latvia: "LV", lithuania: "LT", ukraine: "UA",
  russia: "RU", "russian federation": "RU", belarus: "BY", turkey: "TR", turkiye: "TR",
  "united arab emirates": "AE", uae: "AE", "saudi arabia": "SA", qatar: "QA",
  kuwait: "KW", bahrain: "BH", oman: "OM", israel: "IL", jordan: "JO",
  lebanon: "LB", egypt: "EG",
  "south africa": "ZA", nigeria: "NG", kenya: "KE", ghana: "GH", morocco: "MA",
  cameroon: "CM", "democratic republic of the congo": "CD", senegal: "SN",
  japan: "JP", "south korea": "KR", korea: "KR", china: "CN", "hong kong": "HK",
  macau: "MO", macao: "MO", taiwan: "TW", thailand: "TH", singapore: "SG",
  malaysia: "MY", indonesia: "ID", philippines: "PH", vietnam: "VN",
  cambodia: "KH", myanmar: "MM", burma: "MM", india: "IN", pakistan: "PK",
  kazakhstan: "KZ", kyrgyzstan: "KG", uzbekistan: "UZ", azerbaijan: "AZ",
  georgia: "GE", armenia: "AM", iran: "IR",
  australia: "AU", "new zealand": "NZ", fiji: "FJ",
};

/** Bare-city index, built once — the fallback when a row has no country code. */
const CITY_ONLY: Record<string, GeoPoint> = (() => {
  const out: Record<string, GeoPoint> = {};
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(CITIES)) {
    const city = k.split("|")[0];
    // An ambiguous bare city name (Birmingham GB/US) resolves to nothing rather
    // than to the wrong hemisphere.
    if (seen.has(city)) { delete out[city]; continue; }
    seen.add(city);
    out[city] = v;
  }
  return out;
})();

/** ISO-2 code for a free-text country name, if we recognise it. */
export function countryCodeFor(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.trim();
  if (/^[A-Za-z]{2}$/.test(c) && COUNTRIES[c.toUpperCase()]) return c.toUpperCase();
  return COUNTRY_NAMES[key(c)] ?? null;
}

/**
 * Best-known coordinates for a place, most precise first.
 *
 * Returns `null` rather than guessing: a pin we cannot locate is listed
 * off-map with a "not yet mapped" note, never dropped at (0, 0).
 */
export function resolvePoint(place: {
  city?: string | null;
  country?: string | null;
  countryCode?: string | null;
}): ResolvedPoint | null {
  const cc = (place.countryCode?.trim().toUpperCase() || countryCodeFor(place.country)) ?? null;

  if (place.city) {
    const c = key(place.city);
    if (cc) {
      const hit = CITIES[`${c}|${cc.toLowerCase()}`];
      if (hit) return { ...hit, precision: "city" };
    }
    const bare = CITY_ONLY[c];
    if (bare) return { ...bare, precision: "city" };
  }

  if (cc && COUNTRIES[cc]) return { ...COUNTRIES[cc], precision: "country" };
  return null;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "412 km" / "1,204 km" / "8 mi" — locale-agnostic, metric with an imperial hint. */
export function formatDistance(km: number): string {
  if (km < 1) return "< 1 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

/** How many cities/countries the gazetteer knows — surfaced in the coverage note. */
export const GAZETTEER_SIZE = {
  cities: Object.keys(CITIES).length,
  countries: Object.keys(COUNTRIES).length,
};
