"use client";
import "./fighter-site.css";

import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FighterWebsitePayload } from "@/lib/voicebuild/template/fighterWebsitePayloadSchema";

// The MR-2 website TEMPLATE, data-driven. Lives in its own folder so it can be
// populated from any FighterWebsitePayload (voice pipeline today, backend
// tomorrow). The hero reuses the live site's own classes so it looks identical;
// the rest uses the same MR-2 tokens/fonts with the words swapped in.

const SOCIAL_BASE: Record<string, string> = {
  youtube: "https://youtube.com/",
  instagram: "https://instagram.com/",
  tiktok: "https://tiktok.com/@",
  x: "https://x.com/",
  facebook: "https://facebook.com/",
  twitch: "https://twitch.tv/",
  threads: "https://threads.net/@",
  linkedin: "https://linkedin.com/in/",
  snapchat: "https://snapchat.com/add/",
  website: "",
};
function socialHref(platform: string, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return (SOCIAL_BASE[platform] || "") + value.replace(/^@/, "");
}
function ctaHref(v?: string): string | undefined {
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes("@")) return `mailto:${v}`;
  return v;
}

// Every image slot in the template renders as a dotted "insert image here"
// placeholder — the design is cloned exactly; images are filled in later.
function InsImage({ className = "", caption }: { className?: string; caption?: string }) {
  return (
    <div className={`ins-image ${className}`.trim()} aria-hidden="true">
      <span className="ins-image__txt">Insert image here</span>
      {caption && <span className="ins-image__cap">{caption}</span>}
    </div>
  );
}

const GALLERY_LABELS = ["The Grind", "The Rise", "Ringside", "Fight Night", "Highlights", "Portrait"];

export default function FighterSite({ payload: p }: { payload: FighterWebsitePayload }) {
  const [line1, ...rest] = (p.hero.title || "Fighter").split(/\s+/);
  const line2 = rest.join(" ");
  const socials = Object.entries(p.socials).filter(([, v]) => !!v) as [string, string][];
  const v = p.vitals;
  const vitals: [string, string][] = (
    [
      ["Division", v.division],
      ["Fighting weight", v.fightingWeight ? `${v.fightingWeight.value} ${v.fightingWeight.unit}` : ""],
      ["Nationality", v.nationality],
      ["Residence", v.residence],
      ["Birthplace", v.birthplace],
      ["Debut", v.debutDate],
      ["Bouts", v.bouts != null ? String(v.bouts) : ""],
      ["Rounds", v.rounds != null ? String(v.rounds) : ""],
      ["Ranking", v.ranking],
    ] as [string, string | undefined][]
  ).filter((row): row is [string, string] => !!row[1]);
  const booking = ctaHref(p.contact.bookingUrlOrEmail || p.contact.businessEmail);
  const statement = p.identity.nickname ? `${line1} “${p.identity.nickname}” ${line2}`.trim() : p.hero.title;

  // Pointer-driven parallax + spotlight. Enhancement only: the hero renders and
  // reveals fine without it; this just feeds CSS vars, rAF-throttled.
  const heroRef = useRef<HTMLElement>(null);
  const raf = useRef(0);
  const onHeroMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = heroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const px = (x / r.width - 0.5) * 2; // -1..1
    const py = (y / r.height - 0.5) * 2;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--px", px.toFixed(3));
      el.style.setProperty("--py", py.toFixed(3));
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
    });
  }, []);
  const onHeroLeave = useCallback(() => {
    const el = heroRef.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    el.style.setProperty("--px", "0");
    el.style.setProperty("--py", "0");
  }, []);

  return (
    <main className="gsite">
      <section className="hero" ref={heroRef} onPointerMove={onHeroMove} onPointerLeave={onHeroLeave}>
        <div className="heroMedia">
          <InsImage className="ins-image--hero" />
        </div>
        <div className="heroOverlay" />
        <div className="heroContent">
          {p.hero.eyebrow && <p className="eyebrow">{p.hero.eyebrow}</p>}
          <h1>
            <span className="heroLine"><span className="heroLineInner">{line1}</span></span>
            {line2 && (
              <span className="heroLine"><span className="heroLineInner">{line2}</span></span>
            )}
          </h1>
          {p.hero.tagline && <p className="tagline">{p.hero.tagline}</p>}
          <div className="heroStats">
            <Stat n={p.hero.stats.wins} l="Wins" />
            <Stat n={p.hero.stats.losses} l="Losses" />
            <Stat n={p.hero.stats.draws} l="Draws" />
            <Stat n={p.hero.stats.kos} l="KOs" />
          </div>
          <div className="heroActions">
            {p.media.mainHighlightsUrl && (
              <a className="primaryBtn" href={p.media.mainHighlightsUrl} target="_blank" rel="noreferrer">
                Watch Highlights
              </a>
            )}
            {booking && (
              <a className="outlineBtn" href={booking} target="_blank" rel="noreferrer">
                Book Now
              </a>
            )}
          </div>
        </div>
      </section>

      {(p.about.body || vitals.length > 0) && (
        <section className="gsection">
          <p className="gkicker">About {line1}</p>
          {p.about.headline && <h2 className="gh2">{p.about.headline}</h2>}
          {p.about.body && <p className="gbody">{p.about.body}</p>}
          {vitals.length > 0 && (
            <div className="gvitals">
              {vitals.map(([k, val]) => (
                <div className="gvitals__item" key={k}>
                  <span className="gvitals__k">{k}</span>
                  <strong className="gvitals__v">{val}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {(p.record.fights.length > 0 || p.record.wins + p.record.losses + p.record.draws + p.record.kos > 0) && (
        <section className="gsection">
          <p className="gkicker">Professional Record</p>
          <h2 className="gh2">
            {p.record.wins}-{p.record.losses}-{p.record.draws} · {p.record.kos} KO
          </h2>
          {p.record.fights.length > 0 && (
            <div className="grecord">
              <div className="grecord__head">
                <span>Date</span>
                <span>Opponent</span>
                <span>Result</span>
                <span>Method</span>
              </div>
              {p.record.fights.map((f, i) => (
                <div className="grecord__row" key={i}>
                  <span>{f.date || "—"}</span>
                  <strong>{f.opponent}</strong>
                  <span>{f.result || "—"}</span>
                  <span>{f.method || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="gsection">
        <p className="gkicker">Gallery</p>
        <div className="ggallery">
          {(p.media.gallery.length ? p.media.gallery.map((g) => g.chapterLabel || g.caption || "") : GALLERY_LABELS).map((cap, i) => (
            <figure className="ggallery__item" key={i}>
              <InsImage caption={cap || GALLERY_LABELS[i % GALLERY_LABELS.length]} />
            </figure>
          ))}
        </div>
      </section>

      <footer className="gfooter">
        <p className="gfooter__statement">{statement}</p>
        {p.contact.businessEmail && (
          <a className="gfooter__cta" href={`mailto:${p.contact.businessEmail}`}>
            Business enquiries ↗
          </a>
        )}
        <div className="gfooter__cols">
          {socials.length > 0 && (
            <div>
              <p className="gfooter__label">Follow</p>
              <ul>
                {socials.map(([k, val]) => (
                  <li key={k}>
                    <a href={socialHref(k, val)} target="_blank" rel="noreferrer">
                      {k}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.sponsors.length > 0 && (
            <div>
              <p className="gfooter__label">Sponsors</p>
              <ul>
                {p.sponsors.map((s, i) => (
                  <li key={i}>{s.name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="gfooter__mark">Generated from voice · {p.templateVersion}</p>
      </footer>
    </main>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="stat">
      <strong>{n}</strong>
      <span>{l}</span>
    </div>
  );
}
