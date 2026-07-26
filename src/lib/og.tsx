import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// ════════════════════════════════════════════════════════════════════════════
//  Open Graph.
//
//  ONE renderer for every share card. Each surface supplies a headline, a
//  supporting line and a few stat chips; nothing gets its own layout, so a link
//  from an event, a fight, a fighter or a profile is recognisably the same
//  product.
//
//  Constraints that shaped it:
//    · 1200×630 is the only size every network crops predictably.
//    · Telegram/WhatsApp render small — the headline is huge and never below
//      ~50px, and detail is chips rather than prose.
//    · No remote fonts or images. The renderer runs per-request; a network fetch
//      is a failure mode that turns a share into a blank card.
//
//  FONT: loaded explicitly from public/fonts rather than letting next/og fall
//  back to its bundled font. That fallback builds its path wrongly on Windows
//  (".\file:\C:\…" → ERR_INVALID_URL) and 500s every image. Passing the buffer
//  removes the platform-dependent path entirely.
//
//  Only weight 400 exists, so hierarchy here comes from SIZE, COLOUR, CASE and
//  LETTER-SPACING — never from declaring weights that cannot be rendered.
// ════════════════════════════════════════════════════════════════════════════

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const INK = "#0a0b0d";
const CHALK = "#f4f5f7";
const MIST = "#c7cad1";
const FOG = "#8b909a";
const BLOOD = "#e11d2a";
const GOLD = "#d6a43a";
const VOLT = "#38bdf8";

// Read once per process, not per request.
const FONT = readFileSync(join(process.cwd(), "public", "fonts", "og-noto-sans-400.ttf"));

export interface OgCard {
  /** Small uppercase label — "Main event", "Rankings", the promotion. */
  eyebrow?: string;
  /** The thing itself. Long values step down in size rather than overflowing. */
  headline: string;
  /** One supporting line — event name, division, record. */
  sub?: string | null;
  /** Up to four short facts. */
  chips?: (string | null | undefined)[];
  /** Accent colour (promotion brand). Defaults to blood red. */
  accent?: string | null;
  /** Right-hand emphasis — a record, a reputation score, "VS". */
  badge?: string | null;
}

function headlineSize(text: string): number {
  if (text.length <= 22) return 96;
  if (text.length <= 34) return 80;
  if (text.length <= 50) return 64;
  if (text.length <= 68) return 54;
  return 46;
}

// ════════════════════════════════════════════════════════════════════════════
//  Victory OG — a DEDICATED layout for a resolved prediction, distinct from the
//  generic card so a shared call reads instantly as a Combat Reviews victory and
//  not "another sports graphic". Same constraints (1200×630, one font, no remote
//  images). It carries the five things: the call, that it was hard (badges), the
//  result (verdict + reputation gained), the standing, and the challenge hook.
// ════════════════════════════════════════════════════════════════════════════

export interface VictoryOg {
  rarityLabel: string;
  /** "gold" | "volt" | "blood" — the rarity accent. */
  accent: "gold" | "volt" | "blood";
  win: boolean;
  headline: string;
  /** "<user> called <fighter>". */
  sub: string;
  eyebrow?: string | null; // event / promotion
  /** Up to four short achievement labels; elite ones are passed first. */
  badges: string[];
  /** Reputation delta on a win (>0), else null. */
  repGained: number | null;
}

const ACCENTS = { gold: GOLD, volt: VOLT, blood: BLOOD } as const;

function vHeadlineSize(text: string): number {
  if (text.length <= 16) return 104;
  if (text.length <= 26) return 84;
  if (text.length <= 38) return 68;
  return 56;
}

export function renderVictoryOg(v: VictoryOg): ImageResponse {
  const accent = ACCENTS[v.accent] ?? BLOOD;
  const badges = v.badges.filter(Boolean).slice(0, 4);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: INK, padding: 60, position: "relative" }}>
        {/* Rarity-toned corner glow + accent rail — the instantly-recognisable frame. */}
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", background: `radial-gradient(80% 120% at 100% 0%, ${accent}55, transparent 60%)` }} />
        <div style={{ position: "absolute", top: 0, left: 0, width: 16, height: 630, background: accent, display: "flex" }} />

        {/* Top row — rarity + result badge · wordmark */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", padding: "8px 20px", borderRadius: 8, border: `3px solid ${accent}`, color: accent, fontSize: 24, letterSpacing: 4, textTransform: "uppercase" }}>
              {v.rarityLabel}
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "8px 20px", borderRadius: 8, background: v.win ? VOLT : "#2a2f38", color: v.win ? INK : MIST, fontSize: 24, letterSpacing: 3, textTransform: "uppercase" }}>
              {v.win ? "Called it" : "Missed"}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 5, color: FOG, textTransform: "uppercase" }}>Combat Reviews</div>
        </div>

        {/* Middle — headline + who called what, with the reputation badge on the right */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: v.repGained ? 760 : 1060 }}>
            {v.eyebrow ? (
              <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: accent, textTransform: "uppercase", marginBottom: 14 }}>{v.eyebrow}</div>
            ) : null}
            <div style={{ display: "flex", fontSize: vHeadlineSize(v.headline), lineHeight: 1.0, color: CHALK, letterSpacing: -2 }}>{v.headline}</div>
            <div style={{ display: "flex", marginTop: 18, fontSize: 32, color: MIST }}>{v.sub}</div>
          </div>
          {v.repGained ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 210, height: 210, borderRadius: 28, background: `${GOLD}1f`, border: `4px solid ${GOLD}` }}>
              <div style={{ display: "flex", color: CHALK, fontSize: 76, letterSpacing: -2 }}>{`+${v.repGained}`}</div>
              <div style={{ display: "flex", color: GOLD, fontSize: 24, letterSpacing: 4, textTransform: "uppercase", marginTop: 4 }}>Rep</div>
            </div>
          ) : null}
        </div>

        {/* Bottom — the achievement pills (why it was hard) + the challenge hook */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: 820 }}>
            {badges.length > 0
              ? badges.map((b, i) => (
                  <div key={b} style={{ display: "flex", alignItems: "center", padding: "12px 24px", borderRadius: 999, background: i === 0 ? `${accent}1f` : "#16181d", border: `2px solid ${i === 0 ? accent : "#2a2f38"}`, color: i === 0 ? CHALK : MIST, fontSize: 25 }}>
                    {b}
                  </div>
                ))
              : null}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: FOG, letterSpacing: 1, whiteSpace: "nowrap" }}>Can you beat it?</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "NotoSans", data: FONT, weight: 400, style: "normal" }] },
  );
}

export function renderOgCard(card: OgCard): ImageResponse {
  const accent = card.accent || BLOOD;
  const chips = (card.chips ?? []).filter((c): c is string => !!c).slice(0, 4);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", background: INK, padding: 64, position: "relative",
        }}
      >
        {/* The promotion's colour, so a UFC share and a ONE share are instantly
            different objects in a feed. Spans the FULL canvas: a narrower box
            clips the gradient and leaves a hard vertical seam where it ends. */}
        <div
          style={{
            position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex",
            background: `radial-gradient(75% 110% at 0% 0%, ${accent}5e, transparent 68%)`,
          }}
        />
        <div style={{ position: "absolute", top: 0, left: 0, width: 14, height: 630, background: accent, display: "flex" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 25, letterSpacing: 5, color: accent, textTransform: "uppercase" }}>
            {card.eyebrow ?? ""}
          </div>
          <div style={{ display: "flex", fontSize: 25, letterSpacing: 4, color: FOG, textTransform: "uppercase" }}>
            Combat Reviews
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 44 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: card.badge ? 780 : 1072 }}>
            <div style={{ display: "flex", fontSize: headlineSize(card.headline), lineHeight: 1.06, color: CHALK, letterSpacing: -2 }}>
              {card.headline}
            </div>
            {card.sub ? (
              <div style={{ display: "flex", marginTop: 20, fontSize: 33, color: MIST }}>{card.sub}</div>
            ) : null}
          </div>
          {card.badge ? (
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                minWidth: 200, height: 200, borderRadius: 28, background: `${accent}26`,
                border: `4px solid ${accent}`, color: CHALK, fontSize: 68, padding: "0 26px", letterSpacing: -1,
              }}
            >
              {card.badge}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 14 }}>
          {chips.map((c) => (
            <div
              key={c}
              style={{
                display: "flex", alignItems: "center", padding: "13px 26px", borderRadius: 999,
                background: "#16181d", border: "2px solid #262a32", color: MIST, fontSize: 27,
              }}
            >
              {c}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: "NotoSans", data: FONT, weight: 400, style: "normal" }],
    },
  );
}
