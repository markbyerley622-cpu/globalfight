import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { FightersDirectory } from "@/components/fighters/fighters-directory";

export const metadata: Metadata = {
  title: "Fighters Directory",
  description:
    "The global combat-sports fighter directory — MMA, boxing, Muay Thai, kickboxing, K-1, bare knuckle, BJJ, wrestling, judo, taekwondo and sambo. Search and filter by sport, country, residence and status.",
};

export default function FightersPage() {
  return (
    <>
      <PageHero
        eyebrow="Global combat sports directory"
        title="Fighters"
        description="Every combat sport, one directory — search and filter by sport, country, residence and status. Records are pulled live from the database."
      />
      <div className="container-cr py-10">
        <FightersDirectory />
      </div>
    </>
  );
}
