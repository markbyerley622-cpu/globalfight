import { BadgeCheck, Bell, Bookmark, Building2, CalendarDays, ShieldCheck, Trophy, Users } from "lucide-react";
import { CTA, PERSONAL, ROUTES } from "./content";
import { PrimaryCta } from "./cta";
import { Reveal } from "./reveal";
import { RoleMarquee } from "./role-marquee";
import type { LandingData } from "./data";

/**
 * Why an account is worth making — the quiet section, on purpose.
 *
 * It sits between the loudest thing on the page (the story) and the second
 * loudest (the final CTA), and it is the only section that answers "what
 * changes if I sign up". Two panels, because there are two answers: a fan gets
 * a feed and a record, a professional gets their own page.
 *
 * Both panels are pictures of signed-in surfaces the product already has —
 * /following, /leaderboard, the claim flow — with `aria-hidden` interiors and a
 * describing label, for the same reason the story visuals are: nothing here is a
 * control, so nothing here is announced as one.
 */

const FAN_ROWS = [
  { icon: Users, label: "Following", value: "Fighters, events and promotions" },
  { icon: CalendarDays, label: "Fight week", value: "Reminders before the first bell" },
  { icon: Bookmark, label: "Your picks", value: "Saved, and graded when the bout lands" },
  { icon: Trophy, label: "Your record", value: "Points and accuracy over time" },
  { icon: Bell, label: "Alerts", value: "Only for what you follow" },
];

const INDUSTRY_ROWS = [
  { icon: BadgeCheck, label: "Claim", value: "Your fighter, gym or organisation page" },
  { icon: ShieldCheck, label: "Verification", value: "Reviewed before a page changes hands" },
  { icon: Building2, label: "Relationships", value: "Gym, team and promotion links" },
  { icon: Users, label: "Public record", value: "The bouts, as the sources published them" },
];

function Panel({
  title,
  copy,
  rows,
  label,
  children,
}: {
  title: string;
  copy: string;
  rows: { icon: typeof Users; label: string; value: string }[];
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <Reveal as="article" className="hl-panel">
      <span className="hl-panel-kicker">{title}</span>
      <h3 className="hl-panel-title">{copy}</h3>
      {children}
      <div className="hl-panel-demo" role="img" aria-label={label}>
        <ul aria-hidden="true">
          {rows.map((r) => (
            <li key={r.label}>
              <r.icon className="size-4" />
              <span className="hl-panel-label">{r.label}</span>
              <span className="hl-panel-value">{r.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}

export function PersonalisedExperience({ data }: { data: LandingData }) {
  const top = data.leaders[0] ?? null;

  return (
    <section className="hl-section hl-personal" aria-labelledby="hl-personal-heading">
      <div className="container-cr">
        <Reveal as="header" className="hl-section-head">
          <h2 id="hl-personal-heading" className="hl-h2">
            {PERSONAL.headline}
          </h2>
        </Reveal>

        <div className="hl-panels">
          <Panel
            title={PERSONAL.fan.title}
            copy={PERSONAL.fan.copy}
            rows={FAN_ROWS}
            label="A fan's signed-in surfaces: followed fighters and events, fight-week reminders, saved picks, prediction record and alerts."
          >
            {/* The one number here is a real one from the public predictor board,
                or nothing at all. An invented "12,000 members" would be the
                exact kind of statistic this page must not carry. */}
            {top && (
              <p className="hl-panel-proof">
                Top predictor right now: <strong>{top.name}</strong> · {top.points.toLocaleString()} pts ·{" "}
                {top.accuracy}% accurate
              </p>
            )}
          </Panel>

          <Panel
            title={PERSONAL.industry.title}
            copy={PERSONAL.industry.copy}
            rows={INDUSTRY_ROWS}
            label="A professional's surfaces: claim your page, verification state, gym and organisation relationships, and the public record."
          >
            <p className="hl-panel-roles">
              Sign up as <RoleMarquee />
            </p>
          </Panel>
        </div>

        <Reveal className="hl-personal-cta">
          <PrimaryCta position="personalisation" label={CTA.profile} />
          <a href={ROUTES.following} className="hl-quiet-link">
            See what Following looks like
          </a>
        </Reveal>
      </div>
    </section>
  );
}
