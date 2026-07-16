// ════════════════════════════════════════════════════════════════════════
//  Live combat-sports news ingestion — pulls RSS from every verified source
//  into the Article table. Called by the `news` cron (hourly) and by the
//  `sync:news` CLI. Per-feed fault-tolerant (a dead/slow feed is skipped, not
//  fatal). Idempotent: keyed on slug(title). Newest item becomes featured.
// ════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";

// Honest identification. This ran every 15 minutes in production disguised as
// Chrome; a spoofed UA on a scheduled bot is not a grey area.
import { BOT_HEADERS } from "@/lib/http-identity";
const UA = BOT_HEADERS;

// How many feeds to fetch concurrently, and the per-feed timeout — together
// these keep the whole run comfortably inside the cron's maxDuration.
const CONCURRENCY = 8;
const FEED_TIMEOUT_MS = 8000;

// Full source list across every discipline. Feeds marked "paused" in the source
// register are omitted. Adding many feeds is safe (per-feed fault tolerant).
export const FEEDS: { source: string; category: string; url: string }[] = [
  // ── Boxing ──
  { source: "15Rounds", category: "Boxing", url: "https://15rounds.com/feed/" },
  { source: "Bad Left Hook", category: "Boxing", url: "https://www.badlefthook.com/rss/current.xml" },
  { source: "BBC Sport Boxing", category: "Boxing", url: "https://feeds.bbci.co.uk/sport/boxing/rss.xml" },
  { source: "Boxing Insider", category: "Boxing", url: "https://www.boxinginsider.com/feed/" },
  { source: "Boxing Junkie", category: "Boxing", url: "https://boxingjunkie.usatoday.com/feed/" },
  { source: "Boxing King Media", category: "Boxing", url: "https://www.boxingkingmedia.com/feed/" },
  { source: "Boxing News 24", category: "Boxing", url: "https://www.boxingnews24.com/feed/" },
  { source: "Boxing News Online", category: "Boxing", url: "https://www.boxingnewsonline.net/feed" },
  { source: "Boxing Scene", category: "Boxing", url: "https://www.boxingscene.com/feed/" },
  { source: "Boxing Social", category: "Boxing", url: "https://www.boxingsocial.com/feed/" },
  { source: "East Side Boxing", category: "Boxing", url: "https://www.eastsideboxing.com/feed" },
  { source: "Boxing 247", category: "Boxing", url: "https://www.boxing247.com/feed" },
  { source: "ESPN Boxing", category: "Boxing", url: "https://www.espn.com/espn/rss/boxing/news" },
  { source: "Fight News", category: "Boxing", url: "https://www.fightnews.com/feed" },
  { source: "BOXXER Events", category: "Boxing", url: "https://news.google.com/rss/search?q=%22BOXXER%22+(card+OR+event+OR+announce)&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "DAZN Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=DAZN+boxing+(schedule+OR+card+OR+announce+OR+%22fight+night%22)&hl=en-US&gl=US&ceid=US:en" },
  { source: "Golden Boy", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Golden+Boy%22+boxing+(card+OR+event+OR+announce+OR+schedule)&hl=en-US&gl=US&ceid=US:en" },
  { source: "IBF", category: "Boxing", url: "https://news.google.com/rss/search?q=IBF+boxing+(title+OR+card+OR+event+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "IBO Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=IBO+boxing+(title+OR+card+OR+event+OR+announce)&hl=en-GB&ceid=:en" },
  { source: "Matchroom Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Matchroom+Boxing%22+(card+OR+event+OR+announce+OR+schedule+OR+fight+night)&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "Netflix Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=Netflix+boxing+(schedule+OR+card+OR+announce+OR+stream)&hl=en-US&gl=US&ceid=US:en" },
  { source: "PBC", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Premier+Boxing+Champions%22+OR+PBC+(card+OR+event+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "Prime Video Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Prime+Video%22+boxing+(card+OR+schedule+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "ProBox TV", category: "Boxing", url: "https://news.google.com/rss/search?q=%22ProBox+TV%22+(card+OR+event+OR+announce+OR+schedule)&hl=en-US&gl=US&ceid=US:en" },
  { source: "Queensberry", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Queensberry+Promotions%22+(card+OR+event+OR+announce+OR+schedule)&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "Riyadh Season", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Riyadh+Season%22+boxing+(card+OR+event+OR+announce)&hl=en-GB&ceid=:en" },
  { source: "Top Rank", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Top+Rank%22+boxing+(card+OR+event+OR+announce+OR+schedule)&hl=en-US&gl=US&ceid=US:en" },
  { source: "Wasserman Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Wasserman+Boxing%22+(card+OR+event+OR+announce)&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "WBA", category: "Boxing", url: "https://news.google.com/rss/search?q=WBA+boxing+(title+OR+card+OR+event+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "WBC", category: "Boxing", url: "https://news.google.com/rss/search?q=WBC+boxing+(title+OR+card+OR+event+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "WBO", category: "Boxing", url: "https://news.google.com/rss/search?q=WBO+boxing+(title+OR+card+OR+event+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "Matchroom Boxing Official", category: "Boxing", url: "https://www.matchroomboxing.com/feed/" },
  { source: "ProBoxing-Fans", category: "Boxing", url: "https://www.proboxing-fans.com/feed/" },
  { source: "Ring Magazine", category: "Boxing", url: "https://www.ringtv.com/feed/" },
  { source: "Seconds Out", category: "Boxing", url: "https://www.secondsout.com/rss" },
  { source: "Sky Sports Boxing", category: "Boxing", url: "https://www.skysports.com/rss/12040" },
  { source: "Sporting News Boxing", category: "Boxing", url: "https://www.sportingnews.com/us/boxing/rss" },
  { source: "Talk Sport Boxing", category: "Boxing", url: "https://talksport.com/boxing/feed/" },
  { source: "The Sweet Science", category: "Boxing", url: "https://www.thesweetscience.com/feed/" },
  { source: "Top Rank Official", category: "Boxing", url: "https://www.toprank.com/feed/" },
  { source: "WBC News", category: "Boxing", url: "https://wbcboxing.com/en/feed/" },
  { source: "WBC Official News", category: "Boxing", url: "https://wbcboxing.com/feed/" },
  { source: "World Boxing News", category: "Boxing", url: "https://worldboxingnews.net/feed" },

  // ── MMA ──
  { source: "Bellator", category: "MMA", url: "https://news.google.com/rss/search?q=Bellator+MMA&hl=en-US&gl=US&ceid=US:en" },
  { source: "Bloody Elbow", category: "MMA", url: "https://www.bloodyelbow.com/feed/" },
  { source: "Cage Warriors Official", category: "MMA", url: "https://cagewarriors.com/feed/" },
  { source: "CombatPress", category: "MMA", url: "https://combatpress.com/feed/" },
  { source: "Dana White", category: "MMA", url: "https://news.google.com/rss/search?q=%22Dana+White%22+UFC&hl=en-US&gl=US&ceid=US:en" },
  { source: "Brave CF", category: "MMA", url: "https://news.google.com/rss/search?q=%22Brave+CF%22+OR+%22BRAVE+Combat+Federation%22+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "Cage Warriors", category: "MMA", url: "https://news.google.com/rss/search?q=%22Cage+Warriors%22+(card+OR+event+OR+announce)&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "KSW", category: "MMA", url: "https://news.google.com/rss/search?q=KSW+MMA+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "ONE Championship Events", category: "MMA", url: "https://news.google.com/rss/search?q=%22ONE+Championship%22+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "PFL", category: "MMA", url: "https://news.google.com/rss/search?q=%22Professional+Fighters+League%22+OR+%22PFL%22+(card+OR+event+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "UFC Events", category: "MMA", url: "https://news.google.com/rss/search?q=UFC+(card+OR+%22fight+night%22+OR+announce+OR+schedule)&hl=en-US&gl=US&ceid=US:en" },
  { source: "Low Kick MMA", category: "MMA", url: "https://www.lowkickmma.com/feed" },
  { source: "MMA Fighting", category: "MMA", url: "https://www.mmafighting.com/rss/index.xml" },
  { source: "MMA Junkie", category: "MMA", url: "https://mmajunkie.usatoday.com/feed" },
  { source: "MMA Weekly", category: "MMA", url: "https://www.mmaweekly.com/feed" },
  { source: "ONE Championship MMA", category: "MMA", url: "https://www.onefc.com/news/feed/" },
  { source: "PFL MMA", category: "MMA", url: "https://www.pflmma.com/rss.xml" },
  { source: "Sherdog", category: "MMA", url: "https://www.sherdog.com/rss/news.xml" },
  { source: "Tapology News", category: "MMA", url: "https://www.tapology.com/news.rss" },
  { source: "UFC News", category: "MMA", url: "https://www.ufc.com/rss/news" },
  { source: "UFC YouTube", category: "MMA", url: "https://www.youtube.com/feeds/videos.xml?user=UFC" },

  // ── Bare Knuckle ──
  { source: "Bare Knuckle Boxing", category: "Bare Knuckle", url: "https://news.google.com/rss/search?q=%22bare+knuckle+boxing%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "Bare Knuckle TV", category: "Bare Knuckle", url: "https://bareknuckletv.com/feed/" },
  { source: "BKFC", category: "Bare Knuckle", url: "https://news.google.com/rss/search?q=%22BKFC%22+OR+%22Bare+Knuckle+Fighting%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "BKFC Official News", category: "Bare Knuckle", url: "https://www.bkfc.com/news?format=rss" },
  { source: "Bare Knuckle Boxing UK", category: "Bare Knuckle", url: "https://news.google.com/rss/search?q=%22bare+knuckle+boxing%22+UK+OR+Britain&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "BKFC Fights", category: "Bare Knuckle", url: "https://news.google.com/rss/search?q=%22BKFC%22+fight+OR+results+OR+card&hl=en-US&gl=US&ceid=US:en" },
  { source: "BKFC Schedule", category: "Bare Knuckle", url: "https://news.google.com/rss/search?q=BKFC+(card+OR+%22fight+night%22+OR+schedule+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "BYB Extreme", category: "Bare Knuckle", url: "https://news.google.com/rss/search?q=%22BYB+Extreme%22+(card+OR+event+OR+announce)&hl=en-US&gl=US&ceid=US:en" },

  // ── Kickboxing / Muay Thai ──
  { source: "Beyond Kickboxing", category: "Kickboxing", url: "https://beyondkick.com/feed/" },
  { source: "Glory Kickboxing", category: "Kickboxing", url: "https://glorykickboxing.com/feed" },
  { source: "Glory Kickboxing News", category: "Kickboxing", url: "https://news.google.com/rss/search?q=%22Glory+Kickboxing%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "GLORY Official", category: "Kickboxing", url: "https://www.gloryworldseries.com/feed" },
  { source: "GLORY Events", category: "Kickboxing", url: "https://news.google.com/rss/search?q=%22GLORY+Kickboxing%22+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "K-1 Events", category: "Kickboxing", url: "https://news.google.com/rss/search?q=%22K-1%22+kickboxing+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "Muay Thai Results", category: "Kickboxing", url: "https://news.google.com/rss/search?q=%22Muay+Thai%22+(results+OR+card+OR+fight)&hl=en-US&gl=US&ceid=US:en" },
  { source: "ONE Kickboxing", category: "Kickboxing", url: "https://news.google.com/rss/search?q=%22ONE+Championship%22+kickboxing+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "Rajadamnern / Lumpinee", category: "Kickboxing", url: "https://news.google.com/rss/search?q=%22Rajadamnern%22+OR+%22Lumpinee%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "K-1 Global", category: "Kickboxing", url: "https://www.k-1.co.jp/feed/" },
  { source: "Lumpinee Stadium", category: "Kickboxing", url: "https://news.google.com/rss/search?q=Lumpinee+Muay+Thai&hl=en-US&gl=US&ceid=US:en" },
  { source: "Muay Thai News", category: "Kickboxing", url: "https://news.google.com/rss/search?q=%22Muay+Thai%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "Muay Thai Authority", category: "Kickboxing", url: "https://www.muaythaiauthority.com/feed/" },
  { source: "ONE Championship", category: "Kickboxing", url: "https://www.onefc.com/feed/" },
  { source: "ONE Championship Muay Thai", category: "Kickboxing", url: "https://news.google.com/rss/search?q=%22ONE+Championship%22+%22Muay+Thai%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "Rajadamnern Stadium", category: "Kickboxing", url: "https://news.google.com/rss/search?q=Rajadamnern+Muay+Thai&hl=en-US&gl=US&ceid=US:en" },
  { source: "Thai Boxing", category: "Kickboxing", url: "https://thaiboxing.com/feed/" },

  // ── Brazilian Jiu-Jitsu ──
  { source: "ADCC", category: "BJJ", url: "https://news.google.com/rss/search?q=ADCC+grappling&hl=en-US&gl=US&ceid=US:en" },
  { source: "ADCC News", category: "BJJ", url: "https://adcombat.com/feed" },
  { source: "AJP Tour", category: "BJJ", url: "https://www.ajptour.com/en/feed" },
  { source: "BJJ", category: "BJJ", url: "https://news.google.com/rss/search?q=%22Brazilian+Jiu-Jitsu%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "BJJ Heroes", category: "BJJ", url: "https://www.bjjheroes.com/feed" },
  { source: "BJJEE", category: "BJJ", url: "https://bjjee.com/feed/" },
  { source: "FloGrappling", category: "BJJ", url: "https://www.flograppling.com/rss" },
  { source: "ADCC Events", category: "BJJ", url: "https://news.google.com/rss/search?q=ADCC+(trials+OR+championship+OR+event+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "AJP Tour Events", category: "BJJ", url: "https://news.google.com/rss/search?q=%22AJP+Tour%22+OR+%22Abu+Dhabi+Jiu-Jitsu%22+(event+OR+championship+OR+announce)&hl=en-US&ceid=:en" },
  { source: "FloGrappling Events", category: "BJJ", url: "https://news.google.com/rss/search?q=FloGrappling+(event+OR+card+OR+match+OR+announce)&hl=en-US&gl=US&ceid=US:en" },
  { source: "IBJJF Events", category: "BJJ", url: "https://news.google.com/rss/search?q=IBJJF+(championship+OR+open+OR+event+OR+results)&hl=en-US&gl=US&ceid=US:en" },
  { source: "Grappling Insider", category: "BJJ", url: "https://grapplinginsider.com/feed" },
  { source: "IBJJF News", category: "BJJ", url: "https://ibjjf.com/feed" },
  { source: "Jiu Jitsu Times", category: "BJJ", url: "https://www.jiujitsutimes.com/feed/" },
  { source: "NAGA Fighter", category: "BJJ", url: "https://www.nagafighter.com/blog/feed" },

  // ── Muay Thai (dedicated) ──
  { source: "Lumpinee Stadium Events", category: "Muay Thai", url: "https://news.google.com/rss/search?q=Lumpinee+Muay+Thai+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "Muay Thai Global", category: "Muay Thai", url: "https://news.google.com/rss/search?q=%22Muay+Thai%22+(card+OR+event+OR+announce+OR+title)&hl=en-US&ceid=:en" },
  { source: "ONE Muay Thai Events", category: "Muay Thai", url: "https://news.google.com/rss/search?q=%22ONE+Championship%22+Muay+Thai+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "Rajadamnern Stadium Events", category: "Muay Thai", url: "https://news.google.com/rss/search?q=Rajadamnern+Muay+Thai+(card+OR+event+OR+announce)&hl=en-US&ceid=:en" },
  { source: "Muay Thai Citizen", category: "Muay Thai", url: "https://muaythaicitizen.com/feed/" },

  // ── Wrestling ──
  { source: "411 Mania Wrestling", category: "Wrestling", url: "https://411mania.com/wrestling/feed/" },
  { source: "Cageside Seats", category: "Wrestling", url: "https://www.cagesideseats.com/rss/index.xml" },
  { source: "Fightful Wrestling", category: "Wrestling", url: "https://www.fightful.com/wrestling/feed" },
  { source: "Fightful", category: "Wrestling", url: "https://www.fightful.com/rss.xml" },
  { source: "FloWrestling", category: "Wrestling", url: "https://www.flowrestling.org/rss" },
  { source: "International Wrestling", category: "Wrestling", url: "https://news.google.com/rss/search?q=wrestling+(World+Championships+OR+European+Championships+OR+Asian+Championships+OR+%22Olympic+qualifier%22)&hl=en-US&ceid=:en" },
  { source: "UWW Events", category: "Wrestling", url: "https://news.google.com/rss/search?q=%22United+World+Wrestling%22+OR+UWW+(championship+OR+event+OR+tournament)&hl=en-US&ceid=:en" },
  { source: "Olympic Wrestling", category: "Wrestling", url: "https://news.google.com/rss/search?q=Olympic+wrestling+freestyle&hl=en-US&gl=US&ceid=US:en" },
  { source: "United World Wrestling", category: "Wrestling", url: "https://uww.org/rss.xml" },
  { source: "WrestleTalk", category: "Wrestling", url: "https://www.wrestletalk.com/feed/" },
  { source: "WrestleZone", category: "Wrestling", url: "https://www.wrestlezone.com/feed" },
  { source: "Wrestling Inc", category: "Wrestling", url: "https://www.wrestlinginc.com/feed/" },

  // ── Misfits Boxing ──
  { source: "KSI Boxing", category: "Misfits", url: "https://news.google.com/rss/search?q=KSI+boxing&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "MF & DAZN", category: "Misfits", url: "https://news.google.com/rss/search?q=%22MF+%26+DAZN%22+OR+%22MF+DAZN%22&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "Misfits Boxing", category: "Misfits", url: "https://news.google.com/rss/search?q=%22Misfits+Boxing%22&hl=en-GB&gl=GB&ceid=GB:en" },
  { source: "Misfits Boxing Official", category: "Misfits", url: "https://misfitsboxing.com/feed/" },

  // ── BATL / Middle East Boxing ──
  { source: "Arab News Sport", category: "Boxing", url: "https://www.arabnews.com/rss.xml" },
  { source: "BATL Promotions", category: "Boxing", url: "https://batlpromotions.com/feed/" },
  { source: "BATL Promotions YouTube", category: "Boxing", url: "https://www.youtube.com/feeds/videos.xml?user=batlpromotions" },
  { source: "BATL Promotions News", category: "Boxing", url: "https://news.google.com/rss/search?q=%22BATL+Promotions%22&hl=en-GB&gl=AE&ceid=AE:en" },
  { source: "Middle East Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Middle+East+boxing%22+OR+%22Bahrain+boxing%22+OR+%22Qatar+boxing%22+OR+%22Kuwait+boxing%22+OR+%22Jordan+boxing%22+OR+%22Egypt+boxing%22&hl=en-GB&ceid=:en" },
  { source: "Saudi Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Saudi+Arabia+boxing%22+OR+%22Riyadh+Season%22+boxing&hl=en-GB&gl=SA&ceid=SA:en" },
  { source: "UAE Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=%22UAE+boxing%22+OR+%22Dubai+boxing%22+OR+%22Abu+Dhabi+boxing%22&hl=en-GB&gl=AE&ceid=AE:en" },
  { source: "Gulf News Sport", category: "Boxing", url: "https://gulfnews.com/rss?xrss=sport" },
  { source: "Khaleej Times Sport", category: "Boxing", url: "https://www.khaleejtimes.com/rss/sports.xml" },
  { source: "The National UAE Sport", category: "Boxing", url: "https://www.thenationalnews.com/sport/rss.xml" },

  // ── Crypto Fight Night / Web3 ──
  { source: "Crypto Fight Night", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Crypto+Fight+Night%22+OR+%22cfn.wtf%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "CFN Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=%22CFN%22+boxing&hl=en-US&gl=US&ceid=US:en" },
  { source: "Crypto Boxing", category: "Boxing", url: "https://news.google.com/rss/search?q=crypto+boxing+event&hl=en-US&gl=US&ceid=US:en" },
  { source: "Crypto Fight Night News", category: "Boxing", url: "https://news.google.com/rss/search?q=%22Crypto+Fight+Night%22&hl=en-US&gl=US&ceid=US:en" },
  { source: "Web3 Combat Sports", category: "Boxing", url: "https://news.google.com/rss/search?q=web3+combat+sports&hl=en-US&gl=US&ceid=US:en" },
];

// Drop pro-wrestling and other non-combat-sport noise.
const EXCLUDE = /\b(wwe|aew|nxt|wrestlemania|smackdown|raw\b|njpw|impact wrestling|danhausen|nwo|wcw|tna|cmll|progress wrestling|wrestletalk|wrestlezone)\b/i;

// Decode HTML entities so ESCAPED markup (Google News wraps its <description> as
// &lt;a href=&quot;…&quot;&gt;) becomes real tags we can strip — otherwise the raw
// `a href="…"` link text leaks into excerpts. Decode BEFORE stripping tags.
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, "&"); // last, so &amp;lt; doesn't double-decode
}

const strip = (s: string) =>
  decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g, ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? strip(m[1]) : "";
};

/** Google News appends " - Publisher" to every title; drop that trailing tag. */
const cleanTitle = (t: string) => t.replace(/\s+[-–—]\s+[^-–—]{1,45}$/, "").trim();

/** A description is useless when it's just Google News' relinked title/URL. */
const cleanExcerpt = (s: string) => (/(https?:\/\/|www\.|\bhref=|\.com\/)/i.test(s) ? "" : s);
function imageFrom(itemXml: string): string | null {
  const m = itemXml.match(/<media:content[^>]*url="([^"]+)"/i) || itemXml.match(/<media:thumbnail[^>]*url="([^"]+)"/i)
    || itemXml.match(/<enclosure[^>]*url="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i) || itemXml.match(/<img[^>]*src="([^"]+)"/i);
  return m ? m[1] : null;
}

type Item = { title: string; link: string; date: Date; excerpt: string; image: string | null; source: string; category: string };

async function fetchFeed(f: (typeof FEEDS)[number], out: Item[]): Promise<void> {
  try {
    const res = await fetch(f.url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    const xml = await res.text();
    const blocks = xml.split(/<item[ >]/i).slice(1);
    for (const raw of blocks) {
      const block = "<item " + raw.split("</item>")[0] + "</item>";
      const title = cleanTitle(tag(block, "title"));
      const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "").trim().replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      if (!title || EXCLUDE.test(title)) continue;
      const pub = tag(block, "pubDate") || tag(block, "dc:date");
      const date = pub ? new Date(pub) : new Date();
      if (Number.isNaN(+date)) continue;
      out.push({ title, link, date, excerpt: cleanExcerpt(tag(block, "description")).slice(0, 300), image: imageFrom(block), source: f.source, category: f.category });
    }
  } catch {
    // per-feed fault tolerant — a dead/slow feed is skipped, not fatal
  }
}

/** Pull every feed and upsert into Article. Returns count created+updated. */
export async function ingestNews(): Promise<number> {
  const items: Item[] = [];

  // Bounded-concurrency fetch so the whole run stays inside the cron budget.
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < FEEDS.length) {
      const f = FEEDS[cursor++];
      await fetchFeed(f, items);
    }
  });
  await Promise.all(workers);

  // newest first; newest overall becomes featured
  items.sort((a, b) => +b.date - +a.date);
  const featuredSlug = slugify(items[0]?.title ?? "").slice(0, 80);
  const seen = new Set<string>();
  let created = 0, updated = 0, idx = 0;

  for (const it of items) {
    const slug = slugify(it.title).slice(0, 80);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const data = {
      title: it.title, excerpt: it.excerpt || it.title, content: it.excerpt || it.title,
      category: it.category, metaTitle: it.source, status: "PUBLISHED" as const, // metaTitle holds the RSS source
      featured: idx === 0,
      // Publisher-supplied syndication image (media:content / media:thumbnail /
      // enclosure). These are the images the publisher put IN their feed for
      // syndication; we display them ATTRIBUTED (source name shown) and LINKED
      // back to the original article, and serve them through /api/img — a
      // caching proxy — so we neither hotlink the publisher's bandwidth nor
      // bypass next/image's host allow-list. Facts + credited feed media only.
      coverImageUrl: /^https?:\/\//i.test(it.image ?? "") ? it.image : null,
      sourceUrl: it.link || null, publishedAt: it.date,
    };
    const existing = await prisma.article.findUnique({ where: { slug }, select: { id: true } });
    if (existing) { await prisma.article.update({ where: { id: existing.id }, data }); updated++; }
    else { await prisma.article.create({ data: { slug, ...data } }); created++; }
    idx++;
  }
  // Only the newest is featured.
  if (featuredSlug) {
    await prisma.article.updateMany({ where: { slug: { not: featuredSlug }, featured: true }, data: { featured: false } });
  }

  return created + updated;
}
