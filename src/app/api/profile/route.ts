import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { REGISTRY_ROLE_VALUES, DISCIPLINES } from "@/lib/roles";
import { countryCodeFor } from "@/lib/geo/gazetteer";
import { resolveUserPoint } from "@/lib/geo/people";

// ════════════════════════════════════════════════════════════════════════════
//  The profile control centre — ONE endpoint for every editable field.
//
//  Previously identity was spread across three places: avatar/banner at
//  /api/profile/image, map presence at /api/me/map, and everything else
//  nowhere at all. A user could not change their own display name.
//
//  This is a PATCH of partial fields: the client sends only what changed, so
//  the optimistic UI can save a single toggle without round-tripping the whole
//  profile and racing another tab.
//
//  Avatar/banner stay at /api/profile/image — that is a multipart upload
//  through the image pipeline, not a JSON field, and merging them would mean
//  one endpoint with two content types.
// ════════════════════════════════════════════════════════════════════════════

/** Trim to null so "" clears a field rather than storing an empty string. */
const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => v || null).nullable().optional();

const handle = (max = 60) =>
  z
    .string()
    .trim()
    .max(max)
    // Accept a full URL, an @handle or a bare handle; store the bare handle so
    // the profile can render a consistent "@name" and build its own links.
    .transform((v) => v.replace(/^https?:\/\/(www\.)?[^/]+\//i, "").replace(/^@/, "").replace(/\/$/, "") || null)
    .nullable()
    .optional();

const Body = z.object({
  name: optionalText(60),
  bio: optionalText(400),
  registryRole: z.enum(REGISTRY_ROLE_VALUES as [string, ...string[]]).optional(),
  sportPrefs: z.array(z.enum(DISCIPLINES as unknown as [string, ...string[]])).max(8).optional(),
  website: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
    .nullable()
    .optional(),
  instagram: handle(),
  twitter: handle(),
  youtube: handle(80),
  tiktok: handle(),
  facebook: handle(80),
  weightClassPref: optionalText(40),
  yearsTraining: z.number().int().min(0).max(80).nullable().optional(),
  // Map presence lives here too, so "am I on the map" is edited in the same
  // place as everything else about a person — the Location settings no longer
  // require visiting another screen.
  mapVisibility: z.enum(["HIDDEN", "PUBLIC", "FOLLOWERS", "GYM_MEMBERS", "EVENTS_ONLY"]).optional(),
  mapCity: optionalText(80),
  mapCountry: optionalText(80),
  openToSpar: z.boolean().optional(),
  lookingForTraining: z.boolean().optional(),
});

const SELECT = {
  id: true, name: true, username: true, image: true, bannerUrl: true, bio: true,
  registryRole: true, sportPrefs: true,
  website: true, instagram: true, twitter: true, youtube: true, tiktok: true, facebook: true,
  weightClassPref: true, yearsTraining: true,
  mapVisibility: true, mapCity: true, mapCountryCode: true, mapLat: true, mapLon: true,
  openToSpar: true, lookingForTraining: true,
} as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const [profile, homeGym, promotions] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: SELECT }),
    prisma.gymMember.findFirst({
      where: { userId: user.id, isHome: true },
      select: { gym: { select: { slug: true, name: true, city: true, verified: true } } },
    }),
    prisma.favoritePromotion.findMany({ where: { userId: user.id }, select: { promotion: true } }),
  ]);

  return NextResponse.json({
    profile,
    homeGym: homeGym?.gym ?? null,
    promotions: promotions.map((p) => p.promotion),
  });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }
  const d = parsed.data;

  // Map city → point is resolved server-side, exactly as /api/me/map does. The
  // client still cannot send a coordinate for a person from anywhere in the
  // app; see the note in src/lib/geo/people.ts.
  const touchingLocation = "mapCity" in d || "mapCountry" in d || "mapVisibility" in d;
  let location: Record<string, unknown> = {};
  if (touchingLocation) {
    const current = await prisma.user.findUnique({
      where: { id: user.id },
      select: { mapCity: true, mapCountryCode: true, mapVisibility: true },
    });
    const visibility = d.mapVisibility ?? current?.mapVisibility ?? "HIDDEN";
    const city = d.mapCity !== undefined ? d.mapCity : current?.mapCity ?? null;
    const cc = d.mapCountry !== undefined ? countryCodeFor(d.mapCountry) : current?.mapCountryCode ?? null;
    const clearing = visibility === "HIDDEN";
    const point = resolveUserPoint(city, cc);
    location = {
      mapVisibility: visibility,
      mapCity: clearing ? null : city,
      mapCountryCode: clearing ? null : cc,
      mapLat: clearing ? null : point.mapLat,
      mapLon: clearing ? null : point.mapLon,
    };
  }

  const profile = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: d.name,
      bio: d.bio,
      registryRole: d.registryRole,
      sportPrefs: d.sportPrefs,
      website: d.website,
      instagram: d.instagram,
      twitter: d.twitter,
      youtube: d.youtube,
      tiktok: d.tiktok,
      facebook: d.facebook,
      weightClassPref: d.weightClassPref,
      yearsTraining: d.yearsTraining,
      openToSpar: d.openToSpar,
      lookingForTraining: d.lookingForTraining,
      ...location,
    },
    select: SELECT,
  });

  return NextResponse.json({
    profile,
    warning:
      profile.mapVisibility !== "HIDDEN" && profile.mapLat === null
        ? profile.mapCity
          ? `We don't know where "${profile.mapCity}" is yet, so you won't appear on the map. Try the nearest major city.`
          : "Add your city to appear on the map."
        : null,
  });
}

export const dynamic = "force-dynamic";
