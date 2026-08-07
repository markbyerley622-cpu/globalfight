import { Flag } from "@/components/flag";
import { formatDate } from "@/lib/utils";
import { ECOSYSTEM, WINDOWS } from "./content";
import { PreviewLink } from "./cta";
import { Reveal } from "./reveal";
import type { LandingData } from "./data";

/**
 * Four windows onto the rest of the product.
 *
 * Each one is a PREVIEW: enough real rows to prove the surface exists and to
 * show what it looks like, and no filtering, paging, search or map interaction.
 * That boundary is the difference between a landing page and a second copy of
 * the application — the previous attempt at a marketing route in this codebase
 * failed by crossing it, and every window here links out to the route that owns
 * the behaviour instead of reimplementing it.
 *
 * A window whose data is missing renders its own quiet empty state rather than
 * disappearing. A grid that loses a cell on a slow day looks broken; a cell that
 * says "no results published yet" looks honest.
 */

function Window({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const w = WINDOWS.find((x) => x.id === id)!;
  return (
    <Reveal as="article" className="hl-window" data-window={id}>
      <div className="hl-window-body">
        <h3 className="hl-window-title">{w.copy}</h3>
        <div className="hl-window-demo" aria-label={title}>
          {children}
        </div>
      </div>
      <PreviewLink id={id} href={w.href}>
        {w.linkLabel}
      </PreviewLink>
    </Reveal>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="hl-window-empty">{children}</p>;
}

export function ProductEcosystem({ data }: { data: LandingData }) {
  const { fighter, result, location, coverage } = data;

  return (
    <section className="hl-section hl-ecosystem" aria-labelledby="hl-eco-heading">
      <div className="container-cr">
        <Reveal as="header" className="hl-section-head">
          <h2 id="hl-eco-heading" className="hl-h2">
            {ECOSYSTEM.headline}
          </h2>
          <p className="hl-section-lead">{ECOSYSTEM.support}</p>
        </Reveal>

        <div className="hl-window-grid">
          {/* ── Fighter profiles ───────────────────────────────────────── */}
          <Window id="fighters" title="Fighter profile preview">
            {fighter ? (
              <div className="hl-fighter">
                <div className="hl-fighter-head">
                  <div>
                    <span className="hl-fighter-name">{fighter.name}</span>
                    {fighter.nickname && <span className="hl-fighter-nick">“{fighter.nickname}”</span>}
                  </div>
                  <span className="hl-fighter-record">{fighter.record}</span>
                </div>
                <div className="hl-fighter-meta">
                  <span>{fighter.sport}</span>
                  {fighter.country && (
                    <span className="hl-inline-flag">
                      <Flag code={fighter.countryCode} name={fighter.country} size="xs" />
                      {fighter.country}
                    </span>
                  )}
                </div>

                {fighter.nextFight && (
                  <div className="hl-fighter-next">
                    <span className="hl-mini-label">Next fight</span>
                    <span>
                      vs {fighter.nextFight.opponent} · {formatDate(fighter.nextFight.date, { year: undefined })}
                    </span>
                  </div>
                )}

                {fighter.recent.length > 0 && (
                  <ul className="hl-fighter-history">
                    <li className="hl-mini-label">Recent</li>
                    {fighter.recent.map((r) => (
                      <li key={`${r.opponent}-${r.date}`}>
                        <span className="hl-history-op">{r.opponent}</span>
                        <span className="hl-history-out">{r.outcome}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <Empty>Fighter profiles appear here once the registry has a card booked.</Empty>
            )}
          </Window>

          {/* ── Results ────────────────────────────────────────────────── */}
          <Window id="results" title="Result preview">
            {result ? (
              <div className="hl-result">
                <span className="hl-mini-label">{result.event}</span>
                <p className="hl-result-line">
                  <strong>{result.winner}</strong> def. {result.loser}
                </p>
                <div className="hl-result-meta">
                  <span className="hl-result-method">{result.outcome}</span>
                  <span>{formatDate(result.date, { year: undefined })}</span>
                  <span className="hl-result-status">Final</span>
                </div>
              </div>
            ) : (
              <Empty>Completed cards appear here as their results are recorded.</Empty>
            )}
          </Window>

          {/* ── Location ───────────────────────────────────────────────────
              Place names and counts. Not a map: /map is the map, and dragging
              Leaflet onto a marketing route would ship a second copy of it. */}
          <Window id="location" title="Location preview">
            {location.events.length > 0 || location.gyms.length > 0 ? (
              <div className="hl-location">
                {location.countries > 0 && (
                  <p className="hl-location-count">
                    Upcoming cards in <strong>{location.countries}</strong>{" "}
                    {location.countries === 1 ? "country" : "countries"}
                  </p>
                )}
                <ul className="hl-pins">
                  {location.events.map((e) => (
                    <li key={e.name}>
                      <span className="hl-pin-dot" data-kind="event" aria-hidden="true" />
                      <span className="hl-pin-name">{e.name}</span>
                      <span className="hl-pin-where">
                        {[e.city, e.country].filter(Boolean).join(", ")}
                        <Flag code={e.countryCode} name={e.country} size="xs" />
                      </span>
                    </li>
                  ))}
                  {location.gyms.map((g) => (
                    <li key={g.name}>
                      <span className="hl-pin-dot" data-kind="gym" aria-hidden="true" />
                      <span className="hl-pin-name">{g.name}</span>
                      <span className="hl-pin-where">{[g.city, g.country].filter(Boolean).join(", ")}</span>
                    </li>
                  ))}
                </ul>
                {/* Event and gym markers are told apart by a word as well as a
                    colour — the same rule the corners follow. */}
                <p className="hl-pin-key">
                  <span className="hl-pin-dot" data-kind="event" aria-hidden="true" /> Events
                  <span className="hl-pin-dot" data-kind="gym" aria-hidden="true" /> Gyms
                </p>
              </div>
            ) : (
              <Empty>Events and gyms appear on the map as they are added.</Empty>
            )}
          </Window>

          {/* ── Coverage ───────────────────────────────────────────────── */}
          <Window id="coverage" title="Coverage preview">
            {coverage.length > 0 ? (
              <ul className="hl-coverage">
                {coverage.map((c) => (
                  <li key={c.slug ?? c.title}>
                    <span className="hl-coverage-cat">{c.category}</span>
                    <span className="hl-coverage-title">{c.title}</span>
                    {c.publishedAt && (
                      <span className="hl-coverage-date">{formatDate(c.publishedAt, { year: undefined })}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>News and analysis attach themselves to the card they are about.</Empty>
            )}
          </Window>
        </div>
      </div>
    </section>
  );
}
