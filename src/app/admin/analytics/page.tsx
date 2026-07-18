import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Activity, Users, Target, Repeat, Bell, Heart, Eye, Layers, TrendingUp } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { getCurrentUser } from "@/lib/auth";
import { getLaunchMetrics, type LaunchMetrics } from "@/lib/metrics";

export const metadata: Metadata = { title: "Launch metrics", robots: { index: false } };

const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";

export default async function AdminAnalyticsPage() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) notFound(); // don't reveal the route exists

  const m = await getLaunchMetrics();

  return (
    <>
      <PageHero eyebrow="Innovation accounting" title="Launch metrics">
        <p className="max-w-xl text-sm text-mist">
          The Phase-1 gate: <em>do users come back for the next fight?</em> WAPU is the north star. Retention
          cohorts fill in as the analytics history accrues.
        </p>
      </PageHero>

      <div className="container-cr space-y-8 py-10">
        {/* North star + weekly funnel */}
        <Group title="Habit loop (last 7 days)">
          <Big icon={Target} label="WAPU" hint="Weekly active predicting users — north star" value={m.wapu} />
          <Tile icon={Users} label="WAU" hint="signed-in, 7d" value={m.wau} />
          <Tile icon={Activity} label="DAU" hint="signed-in, 24h" value={m.dau} />
          <Tile icon={Repeat} label="Prediction rate" hint="WAPU / WAU" value={`${m.predictionRate}%`} />
        </Group>

        {/* Retention */}
        <Group title="Retention (registered cohorts)">
          <Ret label="D1" data={m.retentionD1} />
          <Ret label="D7" data={m.retentionD7} />
          <Ret label="D30" data={m.retentionD30} />
        </Group>

        {/* Engagement */}
        <Group title="Engagement (last 7 days)">
          <Tile icon={Eye} label="Pageviews" value={m.pageviews7d} />
          <Tile icon={Target} label="Predictions" value={m.predictionsMade7d} />
          <Tile icon={Heart} label="Follows" value={m.follows7d} />
          <Tile icon={Bell} label="Notif. opens" value={m.notificationOpens7d} />
        </Group>

        {/* Cumulative state */}
        <Group title="Product to date">
          <Tile icon={Users} label="Users" value={m.users} />
          <Tile icon={Target} label="Active predictors" value={m.activePredictors} />
          <Tile icon={TrendingUp} label="Overall accuracy" value={`${m.overallAccuracy}%`} hint={`${m.picksTotal} picks`} />
          <Tile icon={Layers} label="Cards awarded" value={m.cardsAwarded} />
        </Group>
      </div>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-fog">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Big({ icon: Icon, label, hint, value }: { icon: typeof Target; label: string; hint?: string; value: number | string }) {
  return (
    <div className="col-span-2 rounded-2xl border border-blood-500/30 bg-[radial-gradient(400px_140px_at_20%_0%,rgba(225,29,42,0.18),transparent_65%)] p-5">
      <div className="mb-1 flex items-center gap-2 text-blood-300"><Icon className="size-4" /><span className="font-display text-xs font-bold uppercase tracking-wide">{label}</span></div>
      <p className="font-display text-4xl font-black tabular-nums text-chalk">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {hint && <p className="mt-0.5 text-xs text-fog">{hint}</p>}
    </div>
  );
}

function Tile({ icon: Icon, label, hint, value }: { icon: typeof Target; label: string; hint?: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
      <div className="mb-1 flex items-center gap-1.5 text-fog"><Icon className="size-3.5" /><span className="text-[0.65rem] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className="font-display text-2xl font-bold tabular-nums text-chalk">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {hint && <p className="mt-0.5 text-[0.65rem] text-fog">{hint}</p>}
    </div>
  );
}

function Ret({ label, data }: { label: string; data: LaunchMetrics["retentionD1"] }) {
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-fog">{label} retention</p>
      {data ? (
        <>
          <p className="font-display text-2xl font-bold tabular-nums text-chalk">{data.pct}%</p>
          <p className="mt-0.5 text-[0.65rem] text-fog">{data.returned}/{data.cohort} returned</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-fog">No cohort yet</p>
      )}
    </div>
  );
}

export const dynamic = "force-dynamic";
