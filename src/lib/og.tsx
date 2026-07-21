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
