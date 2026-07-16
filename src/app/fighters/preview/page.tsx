import type { Metadata } from "next";
import FighterSite from "@/components/fighters/fighter-site";
import type { FighterWebsitePayload } from "@/lib/voicebuild/template/fighterWebsitePayloadSchema";

// Static, DB-free preview of the fighter-site template so the hero/profile
// interaction can be reviewed on its own. Sample data only — no queries.
export const metadata: Metadata = { title: "Fighter site — preview", robots: { index: false } };

const SAMPLE: FighterWebsitePayload = {
  templateVersion: "fighter-profile-v1",
  identity: {
    fullName: "Diego Marlon Reyes",
    displayName: "Diego Reyes",
    nickname: "El Relámpago",
    role: "Professional Boxer",
    tagline: "Super Lightweight",
  },
  hero: {
    title: "Diego Reyes",
    eyebrow: "Super Lightweight · Guadalajara",
    tagline: "El Relámpago",
    stats: { wins: 27, losses: 1, draws: 0, kos: 19 },
  },
  about: {
    headline: "Built in the gym, sharpened in the lights.",
    body:
      "From the Colonia Libertad gym in Guadalajara to championship undercards, Diego Reyes has turned relentless pressure and a southpaw counter into one of the division's most feared records. Nineteen of his twenty-seven wins have come inside the distance.",
  },
  vitals: {
    fightingWeight: { value: 63.5, unit: "kg" },
    division: "Super Lightweight",
    nationality: "Mexican",
    residence: "Guadalajara, MX",
    birthplace: "Guadalajara, Jalisco",
    age: 26,
    debutDate: "2017-03-11",
    bouts: 28,
    rounds: 142,
    ranking: "#4 WBC",
  },
  record: {
    wins: 27,
    losses: 1,
    draws: 0,
    kos: 19,
    fights: [
      { date: "2025-05-17", opponent: "Andre Will' Coyle", result: "Win", method: "TKO", round: "7", location: "Las Vegas" },
      { date: "2024-11-02", opponent: "Yuki Tanaka", result: "Win", method: "UD", round: "12", location: "Tokyo" },
      { date: "2024-06-15", opponent: "Marcus Bell", result: "Win", method: "KO", round: "3", location: "London" },
      { date: "2023-12-09", opponent: "Ivan Petrov", result: "Loss", method: "SD", round: "12", location: "Berlin" },
      { date: "2023-07-22", opponent: "Carlos Mendez", result: "Win", method: "TKO", round: "5", location: "Guadalajara" },
    ],
  },
  media: {
    mainHighlightsUrl: "https://youtube.com/watch?v=highlights",
    highlightClips: [],
    gallery: [],
  },
  socials: {
    instagram: "diego.reyes",
    youtube: "diegoreyesboxing",
    x: "diegoreyes",
    tiktok: "elrelampago",
  },
  sponsors: [{ name: "Zurda Gloves" }, { name: "Agua Brava" }, { name: "Jalisco Sports" }],
  contact: { businessEmail: "team@diegoreyes.mx", bookingUrlOrEmail: "team@diegoreyes.mx" },
};

export default function FighterSitePreviewPage() {
  // fighter-site.css is scoped under `.mr2site` (so it can't leak into the app
  // shell) — the host is responsible for supplying that scope wrapper.
  return (
    <div className="mr2site">
      <FighterSite payload={SAMPLE} />
    </div>
  );
}
