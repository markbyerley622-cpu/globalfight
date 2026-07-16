"use client";

import type { FighterWebsitePayload } from "@/lib/voicebuild/template/fighterWebsitePayloadSchema";

// A self-contained fighter-website template preview. It sits (blurred) behind
// the voice claim box and "unlocks" once the site is generated. Image slots are
// dotted "insert image here" placeholders — only the words change per fighter.

function InsImage({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink-600 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,.02)_0_12px,rgba(255,255,255,.045)_12px_24px)] text-center text-fog">
      <span className="font-display text-xs font-bold uppercase tracking-[0.2em]">Insert image here</span>
      {label && <span className="text-[10px] uppercase tracking-wide text-ink-500">{label}</span>}
    </div>
  );
}

export function ClaimSiteTemplate({ payload: p }: { payload: FighterWebsitePayload }) {
  const [l1, ...rest] = (p.hero.title || "Your Name").split(/\s+/);
  const l2 = rest.join(" ");
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
    ] as [string, string | undefined][]
  ).filter((r): r is [string, string] => !!r[1]);

  return (
    <div className="min-h-screen bg-ink-950 text-chalk">
      {/* HERO */}
      <section className="relative flex min-h-screen flex-col justify-end overflow-hidden px-6 pb-16 pt-24 md:px-16">
        <div className="absolute inset-6 md:inset-16">
          <InsImage />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent" />
        <div className="relative max-w-4xl">
          <p className="font-display text-xs font-bold uppercase tracking-[0.35em] text-blood-400">
            {p.hero.eyebrow || "Professional Fighter"}
          </p>
          <h1 className="mt-4 font-display text-6xl font-black uppercase leading-[0.92] md:text-8xl">
            {l1}
            {l2 && (
              <>
                <br />
                {l2}
              </>
            )}
          </h1>
          {p.hero.tagline && <p className="mt-5 text-lg text-mist">{p.hero.tagline}</p>}
          <div className="mt-9 flex gap-8">
            {(
              [
                ["Wins", p.hero.stats.wins],
                ["Losses", p.hero.stats.losses],
                ["Draws", p.hero.stats.draws],
                ["KOs", p.hero.stats.kos],
              ] as [string, number][]
            ).map(([label, n]) => (
              <div key={label}>
                <div className="font-display text-4xl font-black text-blood-400 md:text-5xl">{n}</div>
                <div className="text-xs uppercase tracking-wide text-fog">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ABOUT + VITALS */}
      {(p.about.body || vitals.length > 0) && (
        <section className="mx-auto max-w-5xl border-t border-ink-800 px-6 py-20 md:px-16">
          <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-blood-400">About {l1}</p>
          {p.about.body && <p className="mt-5 max-w-2xl whitespace-pre-wrap text-base leading-relaxed text-mist">{p.about.body}</p>}
          {vitals.length > 0 && (
            <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-800 bg-ink-800 sm:grid-cols-4">
              {vitals.map(([k, val]) => (
                <div key={k} className="bg-ink-950 p-4">
                  <div className="text-[10px] uppercase tracking-wide text-fog">{k}</div>
                  <div className="mt-1 font-semibold text-chalk">{val}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* RECORD */}
      <section className="mx-auto max-w-5xl border-t border-ink-800 px-6 py-20 md:px-16">
        <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-blood-400">Professional Record</p>
        <h2 className="mt-3 font-display text-4xl font-black">
          {p.record.wins}-{p.record.losses}-{p.record.draws} · {p.record.kos} KO
        </h2>
      </section>

      {/* GALLERY */}
      <section className="mx-auto max-w-5xl border-t border-ink-800 px-6 py-20 md:px-16">
        <p className="mb-6 font-display text-xs font-bold uppercase tracking-[0.3em] text-blood-400">Gallery</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {["The Grind", "The Rise", "Ringside", "Fight Night", "Highlights", "Portrait"].map((label) => (
            <div key={label} className="aspect-[4/3]">
              <InsImage label={label} />
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-ink-800 px-6 py-24 text-center md:px-16">
        <p className="font-display text-5xl font-black uppercase tracking-tight md:text-7xl">{p.hero.title || "Your Name"}</p>
        {p.contact.businessEmail && (
          <a href={`mailto:${p.contact.businessEmail}`} className="mt-6 inline-block rounded-xl bg-blood-500 px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white">
            Business enquiries ↗
          </a>
        )}
      </footer>
    </div>
  );
}
