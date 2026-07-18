import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHero } from "@/components/page-hero";
import { FighterAvatar } from "@/components/fighter-avatar";
import { getCurrentUser } from "@/lib/auth";
import { getUserCards } from "@/lib/collectibles";
import { RARITIES } from "@/lib/profile-stats";
import type { CardRarity } from "@prisma/client";

export const metadata: Metadata = {
  title: "Collection",
  description: "Your earned fighter cards — every correct call becomes a collectible.",
  alternates: { canonical: "/collection" },
};

const TINT: Record<CardRarity, string> = {
  LEGEND: "border-gold-300/50 text-gold-300",
  CHAMPION: "border-gold-400/50 text-gold-400",
  EPIC: "border-volt-400/40 text-volt-400",
  RARE: "border-blood-400/40 text-blood-300",
  BASE: "border-ink-700 text-fog",
};

export default async function CollectionPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHero eyebrow="Collection" title="Your card collection" />
        <div className="container-cr py-16 text-center">
          <p className="text-sm text-mist">Sign in to start your collection.</p>
          <Link href="/account" className="mt-4 inline-block rounded-lg bg-blood-500 px-5 py-2.5 text-sm font-semibold text-white">Sign in</Link>
        </div>
      </>
    );
  }

  const cards = await getUserCards(user.id);
  const byRarity = new Map<CardRarity, typeof cards>();
  for (const r of RARITIES) byRarity.set(r, []);
  for (const c of cards) byRarity.get(c.rarity)!.push(c);

  return (
    <>
      <PageHero eyebrow="Collection" title="Your card collection">
        <p className="text-sm text-mist">{cards.length.toLocaleString()} card{cards.length === 1 ? "" : "s"} earned — one for every fight you called right.</p>
      </PageHero>

      <div className="container-cr space-y-8 py-10">
        {cards.length === 0 && (
          <p className="card-surface p-10 text-center text-sm text-fog">
            No cards yet. Predict a bout correctly and you&apos;ll earn the winner&apos;s card — rarer the bigger the fight.
          </p>
        )}
        {RARITIES.filter((r) => byRarity.get(r)!.length > 0).map((r) => (
          <section key={r}>
            <h2 className={`mb-3 font-display text-sm font-bold uppercase tracking-widest ${TINT[r].split(" ")[1]}`}>
              {r[0] + r.slice(1).toLowerCase()} · {byRarity.get(r)!.length}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {byRarity.get(r)!.map((c) => (
                <Link
                  key={c.id}
                  href={`/fighters/${c.fighter.slug}`}
                  className={`group flex flex-col items-center gap-2 rounded-xl border bg-ink-900 p-3 text-center transition-all hover:-translate-y-0.5 ${TINT[r].split(" ")[0]}`}
                >
                  <FighterAvatar
                    fighter={{ name: c.fighter.name, imageUrl: c.fighter.imageUrl ?? undefined, thumbUrl: c.fighter.thumbUrl ?? undefined, countryCode: c.fighter.countryCode ?? undefined }}
                    size="lg"
                    showFlag
                  />
                  <div>
                    <p className={`text-[0.55rem] font-bold uppercase tracking-wider ${TINT[r].split(" ")[1]}`}>{r}</p>
                    <p className="truncate font-display text-xs font-bold text-chalk">{c.fighter.name}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export const dynamic = "force-dynamic";
