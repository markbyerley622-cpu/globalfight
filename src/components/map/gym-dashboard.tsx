"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard, Pencil, Users, ImageIcon, Settings, BarChart3,
  BadgeCheck, Flame, ExternalLink, ArrowRight, TriangleAlert,
} from "lucide-react";
import { Chip, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { GymManageForm, type ManagedGym } from "./gym-manage-form";
import { GymMembersManager, type RosterMember } from "./gym-members-manager";
import { GymGalleryManager, type GymPhoto } from "./gym-gallery-manager";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Gym OS — the owner's dashboard.
//
//  Sections rather than one long form: an owner opening this to promote a
//  coach should not have to scroll past the whole profile editor to find the
//  roster.
//
//  All sections render CLIENT-side from data the server already fetched. They
//  are not routes — switching tabs must not cost a round trip, and the profile
//  form's in-flight autosave state must survive a look at the roster.
// ════════════════════════════════════════════════════════════════════════════

type Tab = "overview" | "profile" | "members" | "photos" | "analytics" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "profile", label: "Profile", icon: Pencil },
  { id: "members", label: "Members", icon: Users },
  { id: "photos", label: "Photos", icon: ImageIcon },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
];

export interface GymDashboardData {
  gym: ManagedGym;
  photos: GymPhoto[];
  members: RosterMember[];
  ownerId: string | null;
  presentNow: number;
  checkInsWeek: number;
  pendingClaims: number;
}

export function GymDashboard({ data }: { data: GymDashboardData }) {
  const [tab, setTab] = useState<Tab>("overview");
  const { photos, members, ownerId } = data;
  // Setting a gallery photo as cover writes the gym's heroUrl, so the
  // dashboard's own copy has to follow or Overview keeps showing the old one.
  const [gym, setGym] = useState(data.gym);

  const coaches = members.filter((m) => m.role === "coach" || m.role === "owner").length;

  return (
    <div className="flex flex-col gap-4">
      <ChipRow>
        {TABS.map(({ id, label, icon: Icon }) => (
          <Chip key={id} active={tab === id} onClick={() => setTab(id)} size="sm">
            <Icon className="size-3" />
            {label}
          </Chip>
        ))}
      </ChipRow>

      {tab === "overview" && (
        <Overview data={data} coaches={coaches} onGo={setTab} />
      )}
      {tab === "profile" && <GymManageForm gym={gym} />}
      {tab === "members" && (
        <Panel title="Roster" subtitle="Promote coaches, remove people who've moved on.">
          <GymMembersManager slug={gym.slug} initial={members} ownerId={ownerId} />
        </Panel>
      )}
      {tab === "photos" && (
        <Panel title="Gallery" subtitle="Photos appear on your public page and in search.">
          <GymGalleryManager
            slug={gym.slug}
            initial={photos}
            coverUrl={gym.heroUrl}
            onCoverChange={(url) => setGym((c) => ({ ...c, heroUrl: url }))}
          />
        </Panel>
      )}
      {tab === "analytics" && <Analytics data={data} />}
      {tab === "settings" && <SettingsPanel gym={gym} />}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

/** Profile completeness. Deliberately counts the fields that change whether a
 *  stranger can find and choose this gym, not every column on the table. */
function completeness(gym: ManagedGym, photos: number) {
  const checks: { label: string; done: boolean; tab: Tab }[] = [
    { label: "Add a logo", done: !!gym.logoUrl, tab: "profile" },
    { label: "Add a hero image", done: !!gym.heroUrl, tab: "profile" },
    { label: "Write a description", done: !!gym.description, tab: "profile" },
    { label: "List your disciplines", done: gym.disciplines.length > 0, tab: "profile" },
    { label: "Add your address", done: !!gym.address, tab: "profile" },
    { label: "Add opening hours", done: !!gym.hoursNote, tab: "profile" },
    { label: "Add a contact method", done: !!(gym.website || gym.phone || gym.email), tab: "profile" },
    { label: "Upload at least 3 photos", done: photos >= 3, tab: "photos" },
  ];
  const done = checks.filter((c) => c.done).length;
  return { checks, done, total: checks.length, pct: Math.round((done / checks.length) * 100) };
}

function Overview({
  data, coaches, onGo,
}: { data: GymDashboardData; coaches: number; onGo: (t: Tab) => void }) {
  const { gym, photos, members, presentNow, checkInsWeek, pendingClaims } = data;
  const c = completeness(gym, photos.length);
  const todo = c.checks.filter((x) => !x.done);

  return (
    <div className="flex flex-col gap-4">
      {/* Live strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Members" value={members.length} />
        <Stat label="Coaches" value={coaches} />
        <Stat label="Here now" value={presentNow} tone={presentNow > 0 ? "live" : undefined} />
        <Stat label="Check-ins / 7d" value={checkInsWeek} />
      </div>

      {/* Completeness */}
      <Panel
        title="Profile strength"
        subtitle={
          c.pct === 100
            ? "Your page is complete. Nice."
            : "A complete page ranks better in search and converts more visits into members."
        }
      >
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-valuenow={c.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", c.pct === 100 ? "bg-up" : "bg-blood-500")}
              style={{ width: `${c.pct}%` }}
            />
          </div>
          <span className="font-display text-sm font-black tabular-nums text-chalk">{c.pct}%</span>
        </div>

        {todo.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {todo.slice(0, 4).map((t) => (
              <li key={t.label}>
                <button
                  type="button"
                  onClick={() => onGo(t.tab)}
                  className="tap flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-left text-[0.78rem] text-mist transition-colors hover:border-ink-600 hover:text-chalk"
                >
                  <span className="flex-1">{t.label}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-fog" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {pendingClaims > 0 && (
        <Panel title="Pending claims">
          <p className="flex items-start gap-2 text-[0.78rem] leading-relaxed text-gold-300">
            <TriangleAlert className="mt-px size-4 shrink-0" />
            {pendingClaims} other {pendingClaims === 1 ? "person has" : "people have"} filed a claim on this gym.
            An admin reviews these; your ownership is unaffected unless one is approved.
          </p>
        </Panel>
      )}

      {/* Quick actions */}
      <Panel title="Quick actions">
        <div className="flex flex-wrap gap-2">
          <Action onClick={() => onGo("profile")} icon={<Pencil className="size-3.5" />} label="Edit profile" />
          <Action onClick={() => onGo("members")} icon={<Users className="size-3.5" />} label="Manage roster" />
          <Action onClick={() => onGo("photos")} icon={<ImageIcon className="size-3.5" />} label="Add photos" />
          <Link
            href={`/gyms/${gym.slug}`}
            className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist transition-colors hover:text-chalk"
          >
            <ExternalLink className="size-3.5" /> View public page
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "live" }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900 px-3 py-2.5">
      <p className={cn("font-display text-xl font-black tabular-nums", tone === "live" ? "text-blood-300" : "text-chalk")}>
        {tone === "live" && value > 0 && <Flame className="mr-1 inline size-4" />}
        {value}
      </p>
      <p className="mt-0.5 text-[0.64rem] uppercase tracking-wider text-fog">{label}</p>
    </div>
  );
}

// ── Analytics ───────────────────────────────────────────────────────────────

/**
 * Real numbers only.
 *
 * Check-ins and roster growth come from rows we actually have. Profile views,
 * search appearances and map impressions do NOT exist: AnalyticsEvent records
 * pageviews but nothing attributes them to a gym. Rather than invent a chart,
 * this says so and names the one change that would light it up.
 */
function Analytics({ data }: { data: GymDashboardData }) {
  const joinedLast30 = data.members.filter(
    (m) => Date.now() - new Date(m.joinedAt).getTime() < 30 * 86_400_000,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="What we can measure" subtitle="Counted from real rows — no estimates.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Check-ins / 7d" value={data.checkInsWeek} />
          <Stat label="Here now" value={data.presentNow} tone={data.presentNow > 0 ? "live" : undefined} />
          <Stat label="New members / 30d" value={joinedLast30} />
          <Stat label="Photos" value={data.photos.length} />
        </div>
      </Panel>

      <Panel title="Not measured yet">
        <EmptyState
          compact
          icon={<BarChart3 className="size-5" />}
          title="Views and impressions aren't tracked per gym"
          body={
            <>
              The app records pageviews, but nothing attributes them to a gym — so profile views, search
              appearances and map impressions would be guesses. They&apos;ll appear here once gym-scoped events are
              recorded; the numbers above are real in the meantime.
            </>
          }
        />
      </Panel>
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function SettingsPanel({ gym }: { gym: ManagedGym }) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Verification">
        <div className="flex items-start gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", gym.verified ? "bg-volt-500/15 text-volt-400" : "bg-ink-800 text-fog")}>
            <BadgeCheck className="size-4" />
          </span>
          <p className="text-[0.78rem] leading-relaxed text-mist">
            {gym.verified
              ? "This gym is verified. The badge shows on your page, in search and on the map."
              : "Not verified yet. Verification is granted when an admin approves an ownership claim."}
          </p>
        </div>
      </Panel>

      <Panel title="Visibility" subtitle="Where this gym appears.">
        <ul className="flex flex-col gap-1.5 text-[0.78rem] text-mist">
          <li className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
            On the map — <span className="text-fog">{gym.city ? `pinned at ${gym.city}` : "add a city in Profile to appear"}</span>
          </li>
          <li className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
            In search — <span className="text-fog">by name, city and discipline</span>
          </li>
          <li className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
            In the gym directory — <span className="text-fog">/gyms</span>
          </li>
        </ul>
        <p className="text-[0.68rem] leading-relaxed text-fog">
          A gym page is public by design — people are looking for somewhere to train. To take it down, contact us
          from the public page.
        </p>
      </Panel>

      <Panel title="Danger zone">
        <p className="text-[0.78rem] leading-relaxed text-mist">
          Deleting a gym removes its roster, photos and check-in history for everyone who trains there. That is not
          a self-service action, and it is not hidden behind a button that does nothing: contact us and an admin
          will handle it with you.
        </p>
      </Panel>
    </div>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────────

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-chalk">{title}</h3>
      {subtitle && <p className="mt-1 text-[0.72rem] leading-relaxed text-fog">{subtitle}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Action({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-2 font-display text-[0.7rem] font-bold uppercase tracking-wide text-mist transition-colors hover:text-chalk"
    >
      {icon} {label}
    </button>
  );
}
