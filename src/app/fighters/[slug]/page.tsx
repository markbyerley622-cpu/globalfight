import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Ruler, Hand, MapPin, Calendar, Dumbbell, Trophy, Activity, Award,
  Instagram, Twitter, Globe, Mail, Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FighterAvatar } from "@/components/fighter-avatar";
import { AvatarUploader } from "@/components/fighters/avatar-uploader";
import { BackButton } from "@/components/back-button";
import { getCurrentUser } from "@/lib/auth";
import { RecordDonut, StatBar } from "@/components/charts";
import { getFighter, getFighterFights } from "@/lib/repo";
import { winningCorner, currentStreak } from "@/lib/event-format";
import { isPlaceholderName, isPlaceholderSlug } from "@/lib/entities/placeholder";
import { resolveFighterRecord, canShowStreak, recordsByDiscipline } from "@/lib/fighters/record";
import { isFollowingFighter } from "@/lib/follows";
import { FollowButton } from "@/components/follow-button";
import { getFighterPublicProfile } from "@/lib/fighters/profile";
import { SITE } from "@/lib/config";
import { SPORT_LABEL, formatSportRecord, SPORTS } from "@/lib/sports";
import { recommendVideos } from "@/lib/feed/recommend";
import { VideoRail } from "@/components/feed/video-rail";
import { VideoCard, VideoCardProvider } from "@/components/feed/video-card";
import { Flag } from "@/components/flag";
import { ageFrom, koPercentage, formatDate } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const f = await getFighterPublicProfile(slug);
  if (!f) return {};
  // A placeholder is not a person, so it gets no indexable metadata (the page
  // itself 404s below). See lib/entities/placeholder.
  if (isPlaceholderName(f.name) || isPlaceholderSlug(slug)) return { robots: { index: false, follow: false } };
  const sportLabel = SPORT_LABEL[f.sport] ?? f.sport;
  const title = `${f.name}${f.nickname ? ` "${f.nickname}"` : ""} — ${sportLabel} profile`;
  // "Official profile" is a claim of the athlete's own authorship, and it was
  // being made for every unclaimed record we scraped — on pages whose record and
  // vitals we could not even fill in. It is now said only where it is TRUE: a
  // profile the athlete has claimed and had verified. Everything else is
  // described as what it is, a Combat Reviews profile.
  //
  // Fields are composed CONDITIONALLY: interpolating a missing nationality left
  // descriptions reading "Rose Namajunas:  ·  · . " in search results.
  const provenance = f.claimed
    ? "Verified official profile, record, achievements, gallery and contact on Combat Reviews."
    : "Record, achievements and fight history on Combat Reviews.";
  const facts = [f.name && formatSportRecord(f) ? `${f.name}: ${formatSportRecord(f)}` : f.name, sportLabel, f.nationality]
    .filter(Boolean)
    .join(" · ");
  const description = `${facts}. ${f.tagline ?? provenance}`.replace(/\s+/g, " ").trim();
  // NO `images` override. There is a designed card at ./opengraph-image (name,
  // record in the badge, nationality/gym/KO-rate chips, CR mark), and setting
  // `images` here SHADOWED it: this route advertised the fighter's portrait
  // instead — or, for the majority of fighters who have no photo, a bare
  // /cr-logo.png. Both are wrong for a 1200×630 slot: a portrait is the wrong
  // aspect and gets cropped through the face by every network, and a lone logo
  // tells a reader nothing about who they are being shown.
  //
  // The photo still belongs on the PAGE. It does not belong in the share card.
  return {
    title, description,
    alternates: { canonical: `/fighters/${slug}` },
    openGraph: { title, description, type: "profile", url: `${SITE.url}/fighters/${slug}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

function youTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
  return m ? m[1] : null;
}

export default async function FighterProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [profile, fighter] = await Promise.all([getFighterPublicProfile(slug), getFighter(slug)]);
  if (!profile || !fighter) notFound();
  // "TBA" got a Fighter row from ingest, and therefore a profile page reachable
  // from every event card that had an unannounced opponent. It is not a person:
  // no route, no metadata, no sitemap entry.
  if (isPlaceholderName(fighter.name) || isPlaceholderSlug(slug)) notFound();

  const fights = await getFighterFights(slug);
  const currentUser = await getCurrentUser();
  const isOwner = !!currentUser && !!profile.ownerId && profile.ownerId === currentUser.id;
  const following_ = currentUser ? await isFollowingFighter(currentUser.id, fighter.id) : false;
  const upcoming = fights.find((f) => f.result === "SCHEDULED");
  const past = fights.filter((f) => f.result !== "SCHEDULED");
  const streak = currentStreak(fights, slug);
  // The headline record: the imported one when we have it, otherwise counted
  // from settled bouts, otherwise NOTHING. Never zeros standing in for absence.
  const record = resolveFighterRecord(profile, fights, slug);
  // Per-discipline records, from the bout rulesets. Read from the canonical
  // graph — no discipline is resolved here.
  const byDiscipline = recordsByDiscipline(fights, slug);
  const showStreak = canShowStreak(record, past.length);
  const age = ageFrom(fighter.birthDate);
  const ko = koPercentage(fighter.koWins, fighter.wins);
  const sportLabel = SPORT_LABEL[profile.sport] ?? profile.sport;

  // Contextual video, from what this page ALREADY knows: the fighter's name,
  // their discipline, and the promotions they have actually fought for. One
  // query — see lib/feed/recommend.
  const fighterVideos = await recommendVideos({
    fighterNames: [profile.name],
    disciplines: [SPORTS.find((sp) => sp.value === profile.sport)?.slug ?? ""].filter(Boolean),
    // No promotion context: the Fight type carries no promotion, and adding a
    // query to fetch one would buy a weaker signal than the two above.
    viewerId: currentUser?.id ?? null,
    limit: 4,
  });

  const socialIcon: Record<string, typeof Globe> = { instagram: Instagram, twitter: Twitter, web: Globe, website: Globe };
  const allSocials = [
    ...profile.socials,
    ...(profile.instagram ? [{ id: "ig", platform: "instagram", url: profile.instagram }] : []),
    ...(profile.twitter ? [{ id: "tw", platform: "twitter", url: profile.twitter }] : []),
    ...(profile.website ? [{ id: "web", platform: "web", url: profile.website }] : []),
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.name,
    alternateName: profile.nickname ?? undefined,
    nationality: profile.nationality ?? undefined,
    image: profile.imageUrl ?? undefined,
    url: `${SITE.url}/fighters/${slug}`,
    jobTitle: `${sportLabel} athlete`,
    sameAs: allSocials.map((s) => s.url),
  };

  // Vital stats we ACTUALLY hold. Every cell used to fall back to an em dash, so
  // a fighter we have no vitals for got a six-cell grid of dashes under the
  // heading "Vital Stats" — which reads as a broken component rather than as
  // missing data. Unknown fields are omitted, and the block disappears entirely
  // when we know none of them.
  const stats = [
    { icon: Calendar, label: "Age", value: age ? `${age}` : null },
    { icon: Ruler, label: "Height", value: fighter.heightCm ? `${(fighter.heightCm / 30.48) | 0}'${Math.round((fighter.heightCm / 2.54) % 12)}"` : null },
    { icon: Activity, label: "Reach", value: fighter.reachCm ? `${Math.round(fighter.reachCm / 2.54)}"` : null },
    { icon: Hand, label: "Stance", value: fighter.stance ?? null },
    { icon: MapPin, label: "Residence", value: profile.residence ?? profile.nationality ?? null },
    { icon: Dumbbell, label: "Gym", value: profile.gym ?? null },
  ].filter((s): s is typeof s & { value: string } => Boolean(s.value));

  return (
    <>
      <JsonLd data={jsonLd} />

      {/* Hero — branded banner: dark themed base + the fighter's photo as
          intentional blurred/darkened ambiance + brand glows + CR logo mark. */}
      <section className="relative overflow-hidden border-b border-ink-800">
        <div className="absolute inset-0 bg-ink-950" />
        {(profile.heroImageUrl || profile.imageUrl) && (
          <div
            className="absolute inset-0 scale-110 bg-cover bg-top opacity-30 blur-[3px]"
            style={{ backgroundImage: `url(${profile.heroImageUrl ?? profile.imageUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-grid opacity-[0.12]" />
        <div className="absolute -left-32 -top-24 size-[32rem] rounded-full bg-blood-700/25 blur-[120px]" />
        <div className="absolute -bottom-28 -right-24 size-[28rem] rounded-full bg-gold-600/10 blur-[120px]" />
        {/* darker shade gradients — legibility + premium depth */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/75 to-ink-950/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/90 via-transparent to-ink-950/50" />
        <div className="absolute inset-0 vignette" />
        {/* Brandmark */}
        <div className="pointer-events-none absolute right-4 top-4 opacity-40 sm:right-8 sm:top-6">
          <Image src="/cr-logo.png" alt="Combat Reviews" width={120} height={80} className="h-7 w-auto sm:h-9" />
        </div>
        <div className="container-cr relative py-12 lg:py-16">
          <BackButton fallback="/leaderboard" label="Back to Leaderboard" className="mb-6" />
          <div className="flex flex-col items-center gap-6 text-center lg:flex-row lg:items-end lg:text-left">
            {isOwner ? (
              <AvatarUploader slug={slug} className="scale-125">
                <FighterAvatar
                  fighter={{ name: profile.name, imageUrl: profile.imageUrl ?? undefined, thumbUrl: profile.thumbUrl ?? undefined, countryCode: profile.countryCode ?? undefined }}
                  size="xl" showFlag
                />
              </AvatarUploader>
            ) : (
              <FighterAvatar
                fighter={{ name: profile.name, imageUrl: profile.imageUrl ?? undefined, thumbUrl: profile.thumbUrl ?? undefined, countryCode: profile.countryCode ?? undefined }}
                size="xl" showFlag className="scale-125"
              />
            )}
            <div className="flex-1">
              <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                {profile.nickname && <Badge tone="gold">&ldquo;{profile.nickname}&rdquo;</Badge>}
                <Badge tone="neutral">{sportLabel}</Badge>
                {profile.promoter && <Badge tone="red">{profile.promoter}</Badge>}
                <Badge tone={profile.active ? "red" : "neutral"}>{profile.active ? "Active" : "Inactive"}</Badge>
              </div>
              <h1 className="mt-2 flex flex-wrap items-center justify-center gap-3 font-display text-4xl font-bold uppercase tracking-tight text-chalk sm:text-5xl lg:justify-start lg:text-6xl">
                <Flag code={profile.countryCode ?? undefined} name={profile.nationality} size="lg" className="h-8 w-12" /> {profile.name}
              </h1>
              <p className="mt-2 text-sm text-mist">
                {[profile.nationality, profile.residence, record ? formatSportRecord({ ...record, sport: profile.sport }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {profile.tagline && <p className="mt-1 text-sm italic text-fog">{profile.tagline}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                {!isOwner && <FollowButton kind="fighter" slug={slug} name={profile.name} initialFollowing={following_} />}
              </div>
            </div>
            {upcoming && (
              <div className="shrink-0 rounded-xl border border-blood-500/30 bg-blood-500/10 p-4 text-center">
                <p className="text-[0.65rem] uppercase tracking-widest text-blood-300">Next Fight</p>
                <p className="mt-1 font-display text-sm font-bold text-chalk">vs {upcoming.red.slug === slug ? upcoming.blue.name : upcoming.red.name}</p>
                <p className="text-xs text-fog">{formatDate(upcoming.date)}</p>
                <ButtonLink href={`/predictions/${upcoming.slug}`} size="sm" className="mt-2">Prediction</ButtonLink>
              </div>
            )}
          </div>
        </div>

        {/* Photo attribution — required by the CC licence for Commons photos. */}
        {profile.photoLicense && (
          <p className="absolute bottom-1.5 left-4 z-10 text-[10px] text-fog/80">
            Photo:{" "}
            {profile.photoCredit ? `${profile.photoCredit} · ` : ""}
            {profile.photoLicenseUrl ? (
              <a href={profile.photoLicenseUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-mist">
                {profile.photoLicense}
              </a>
            ) : (
              profile.photoLicense
            )}
            {profile.photoSource ? `, via ${profile.photoSource}` : ""}
          </p>
        )}
      </section>

      <div className="container-cr grid gap-6 py-10 lg:grid-cols-[1fr_1.6fr]">
        {/* Left column */}
        <div className="space-y-6">
          {/* The record block renders only when there IS a record. It used to
              take profile.wins/losses/draws raw, so a fighter whose record has
              not been imported got a donut of nothing and three large zeros —
              directly above a fight history listing their bouts and results.
              See lib/fighters/record: stored, derived, or nothing. */}
          {record && (
            <div className="card-surface flex flex-col items-center gap-4 p-6">
              <RecordDonut wins={record.wins} losses={record.losses} draws={record.draws} />
              <div className="grid w-full grid-cols-3 gap-2 text-center">
                {[["Wins", record.wins, "text-up"], ["Losses", record.losses, "text-down"], ["Draws", record.draws, "text-fog"]].map(([l, v, c]) => (
                  <div key={l as string} className="rounded-lg bg-ink-950/40 p-2">
                    <p className={`font-display text-xl font-bold ${c}`}>{v as number}</p>
                    <p className="text-[0.6rem] uppercase tracking-wider text-fog">{l as string}</p>
                  </div>
                ))}
              </div>
              {record.source === "derived" && (
                // A count of the bouts we hold is a FLOOR, not an official
                // record — we do not have every fighter's regional or amateur
                // career. Saying so is what makes showing it honest.
                <p className="text-center text-[0.65rem] leading-snug text-fog">
                  Counted from {record.countedBouts} recorded {record.countedBouts === 1 ? "bout" : "bouts"} on Combat Reviews. No official record imported yet.
                </p>
              )}
              {showStreak && streak !== 0 && (
                <p
                  className={`w-full rounded-lg py-1.5 text-center font-display text-xs font-bold uppercase tracking-wide ${
                    streak > 0 ? "bg-up/15 text-up" : "bg-down/15 text-down"
                  }`}
                >
                  {streak > 0 ? `${streak}-fight win streak` : `${-streak}-fight skid`}
                </p>
              )}
            </div>
          )}

          {/* DISCIPLINES — the canonical graph, read not recomputed.
              Records are grouped per discipline and never summed: a fighter's
              Muay Thai record and their MMA record are different facts, and
              merging them produces a number that describes nobody. */}
          {byDiscipline.records.length > 0 && (
            <div className="card-surface space-y-3 p-6">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-sm font-bold uppercase tracking-wide text-fog">Disciplines</h3>
                {profile.disciplineTier && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider ${
                      profile.disciplineTier === "HIGH"
                        ? "bg-up/15 text-up"
                        : profile.disciplineTier === "MEDIUM"
                          ? "bg-volt-500/15 text-volt-400"
                          : "bg-ink-800 text-fog"
                    }`}
                    title={
                      profile.disciplineTier === "HIGH"
                        ? "Every bout's ruleset was stated by the source."
                        : profile.disciplineTier === "MEDIUM"
                          ? "Rulesets derived from single-ruleset promotions."
                          : "No bout evidence — an imported label only."
                    }
                  >
                    {profile.disciplineTier === "HIGH" ? "Verified" : profile.disciplineTier === "MEDIUM" ? "Derived" : "Imported"}
                  </span>
                )}
              </div>

              {profile.primarySport && (
                <p className="text-xs text-fog">
                  Primary{" "}
                  <span className="font-display text-sm font-bold text-chalk">
                    {SPORT_LABEL[profile.primarySport] ?? profile.primarySport}
                  </span>
                  {profile.sports.length > 1 && (
                    <>
                      {" · also competes in "}
                      <span className="text-mist">
                        {profile.sports
                          .filter((s) => s !== profile.primarySport)
                          .map((s) => SPORT_LABEL[s] ?? s)
                          .join(", ")}
                      </span>
                    </>
                  )}
                </p>
              )}

              <ul className="space-y-1.5">
                {byDiscipline.records.map((r) => (
                  <li key={r.ruleset} className="flex items-baseline justify-between gap-3 rounded-lg bg-ink-950/40 px-3 py-2">
                    <span className="truncate text-xs font-semibold text-mist">
                      {SPORT_LABEL[r.ruleset] ?? r.ruleset.replace(/_/g, " ")}
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-chalk">
                      {r.wins}-{r.losses}-{r.draws}
                      {r.noContests > 0 && <span className="text-fog"> ({r.noContests} NC)</span>}
                    </span>
                  </li>
                ))}
              </ul>

              {byDiscipline.unknown > 0 && (
                // Never folded into a discipline they might not belong to.
                <p className="text-[0.65rem] leading-snug text-fog">
                  {byDiscipline.unknown} further {byDiscipline.unknown === 1 ? "bout" : "bouts"} on record whose
                  ruleset no source stated — not counted above.
                </p>
              )}
            </div>
          )}

          {record && record.wins > 0 && fighter.koWins > 0 && (
            <div className="card-surface space-y-4 p-6">
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-fog">Finishing</h3>
              <StatBar label="KO / TKO Ratio" value={ko} tone="red" />
              <StatBar label="Decision Ratio" value={100 - ko} tone="volt" />
            </div>
          )}

          {stats.length > 0 && (
            <div className="card-surface p-6">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-fog">Vital Stats</h3>
              <dl className="grid grid-cols-2 gap-3">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-lg bg-ink-950/40 p-3">
                    <s.icon className="mb-1 size-4 text-blood-400" />
                    <dt className="text-[0.6rem] uppercase tracking-wider text-fog">{s.label}</dt>
                    <dd className="truncate font-display text-sm font-bold text-chalk">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {profile.achievements.length > 0 && (
            <div className="card-surface p-6">
              <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-gold-400"><Award className="size-4" /> Achievements</h3>
              <ul className="space-y-2">
                {profile.achievements.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg bg-gold-500/5 px-3 py-2 ring-1 ring-gold-500/20">
                    <span className="text-sm text-chalk">{a.title}</span>
                    {a.year && <span className="text-xs text-fog">{a.year}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fighter.titles && fighter.titles.length > 0 && (
            <div className="card-surface p-6">
              <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-gold-400"><Trophy className="size-4" /> Titles</h3>
              <ul className="space-y-2">
                {fighter.titles.map((t, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg bg-gold-500/5 px-3 py-2 ring-1 ring-gold-500/20">
                    <span className="font-display text-sm font-bold text-gold-300">{t.body}</span>
                    <span className="text-xs text-mist">{t.weight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {profile.sponsors.length > 0 && (
            <div className="card-surface p-6">
              <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-fog"><Star className="size-4 text-blood-400" /> Sponsors</h3>
              <div className="grid grid-cols-2 gap-2">
                {profile.sponsors.map((s) => (
                  <a key={s.id} href={s.url ?? "#"} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/40 p-2.5 text-sm text-mist hover:border-blood-500/40 hover:text-chalk">
                    {s.logoUrl && <Image src={s.logoUrl} alt={s.name} width={24} height={24} className="size-6 rounded object-contain" />}
                    <span className="truncate">{s.name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {(allSocials.length > 0 || profile.contactEmail) && (
            <div className="card-surface p-6">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-fog">Connect</h3>
              <div className="flex flex-wrap gap-2">
                {allSocials.map((s) => {
                  const Icon = socialIcon[s.platform] ?? Globe;
                  return (
                    <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-xs font-semibold text-mist hover:border-blood-500/40 hover:text-chalk">
                      <Icon className="size-4" /> {s.platform}
                    </a>
                  );
                })}
                {profile.contactEmail && (
                  <a href={`mailto:${profile.contactEmail}`} className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-xs font-semibold text-mist hover:border-blood-500/40 hover:text-chalk"><Mail className="size-4" /> Email</a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {profile.bio && (
            <div className="card-surface p-6">
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-fog">Biography</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-mist">{profile.bio}</p>
            </div>
          )}

          {profile.photos.length > 0 && (
            <div className="card-surface p-6">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-fog">Gallery</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {profile.photos.map((p) => (
                  <div key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-ink-800">
                    <Image src={p.url} alt={p.caption ?? profile.name} fill className="object-cover" sizes="(max-width:640px) 50vw, 200px" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {profile.videos.length > 0 && (
            <div className="card-surface p-6">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-fog">Videos</h3>
              {/* Curated videos now use the SHARED card. They used to mount one
                  iframe each on page load — a third-party document per video,
                  before anyone asked to watch. Thumbnail until clicked, and one
                  player at a time, exactly like every other video surface. */}
              <VideoCardProvider>
                <div className="grid gap-3 sm:grid-cols-2">
                  {profile.videos.map((v) => {
                    const yt = youTubeId(v.url);
                    return yt ? (
                      <VideoCard
                        key={v.id}
                        video={{ id: yt, title: v.caption ?? profile.name, channel: profile.name }}
                      />
                    ) : (
                      <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer" className="flex aspect-video items-center justify-center rounded-lg border border-ink-700 bg-ink-950/40 text-sm text-mist hover:text-chalk">{v.caption ?? "Watch video"}</a>
                    );
                  })}
                </div>
              </VideoCardProvider>
            </div>
          )}

          {fighterVideos.length > 0 && (
            <div className="card-surface p-6">
              <VideoRail
                videos={fighterVideos}
                title={`Watch · ${profile.name}`}
                moreHref="/clips"
              />
            </div>
          )}

          <div className="card-surface overflow-hidden">
            <h3 className="border-b border-ink-700 px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-fog">Fight History</h3>
            {past.length > 0 ? (
              <ul className="divide-y divide-ink-800">
                {past.map((f) => {
                  const isRed = f.red.slug === slug;
                  const opp = isRed ? f.blue : f.red;
                  const corner = winningCorner(f);
                  // W / L / D / NC — no longer forces a loss for draws or when
                  // winnerId is stored as an id rather than a slug.
                  const outcome =
                    corner === null
                      ? f.result === "NO_CONTEST" ? "NC" : "D"
                      : (corner === "red") === isRed ? "W" : "L";
                  const tone =
                    outcome === "W" ? "bg-up/20 text-up" : outcome === "L" ? "bg-down/20 text-down" : "bg-ink-700 text-mist";
                  return (
                    <li key={f.id}>
                      <Link href={`/predictions/${f.slug}`} className="flex items-center gap-4 px-6 py-3 hover:bg-ink-800/50">
                        <span className={`flex size-8 items-center justify-center rounded font-display text-xs font-bold ${tone}`}>{outcome}</span>
                        <FighterAvatar fighter={opp} size="sm" showFlag />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-sm font-semibold text-chalk">{opp.name}</p>
                          <p className="text-xs text-fog">{formatDate(f.date)} · {f.weightClass}</p>
                        </div>
                        <span className="text-xs font-bold text-mist">{f.method}{f.roundEnded ? ` R${f.roundEnded}` : ""}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-fog">No fight history on record yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Reads the database at runtime — never statically prerendered at build.
export const dynamic = "force-dynamic";
