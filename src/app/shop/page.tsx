import type { Metadata } from "next";
import { ShoppingBag } from "lucide-react";
import { PageHero } from "@/components/page-hero";

export const metadata: Metadata = {
  title: "Shop",
  description: "Combat Register shop — badges, banners and profile flair earned from predictions. Coming soon.",
  alternates: { canonical: "/shop" },
};

export default function ShopPage() {
  return (
    <>
      <PageHero eyebrow="Rewards" title="Shop" description="Spend prediction winnings on badges, banners and profile flair. Free to play — no real money." />
      <div className="container-cr py-10">
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-ink-700 bg-ink-900/60 p-10 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-ink-700 bg-ink-800 text-mist"><ShoppingBag className="size-6" /></span>
          <div className="mt-4 font-display text-base font-bold uppercase tracking-wide text-chalk">Shop coming soon</div>
          <p className="mx-auto mt-2 max-w-xs text-sm text-fog">Climb the prediction leaderboard to earn points, then redeem them here for profile flair.</p>
        </div>
      </div>
    </>
  );
}
