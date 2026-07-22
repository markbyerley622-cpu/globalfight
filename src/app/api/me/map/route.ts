import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { resolveUserPoint } from "@/lib/geo/people";
import { countryCodeFor } from "@/lib/geo/gazetteer";

const VISIBILITY = ["HIDDEN", "PUBLIC", "FOLLOWERS", "GYM_MEMBERS", "EVENTS_ONLY"] as const;

const Body = z.object({
  mapVisibility: z.enum(VISIBILITY),
  /** A CITY, never a coordinate. The client cannot send us a position. */
  mapCity: z.string().trim().max(80).nullable().optional(),
  mapCountry: z.string().trim().max(80).nullable().optional(),
  openToSpar: z.boolean().optional(),
  lookingForTraining: z.boolean().optional(),
});

/** The viewer's own map presence settings. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      mapVisibility: true, mapCity: true, mapCountryCode: true,
      mapLat: true, mapLon: true, openToSpar: true, lookingForTraining: true,
    },
  });
  return NextResponse.json({ settings: me, onMap: me?.mapVisibility !== "HIDDEN" && me?.mapLat !== null });
}

/**
 * Update map presence.
 *
 * The API accepts a CITY NAME and resolves it to a point server-side. There is
 * deliberately no endpoint anywhere that accepts a latitude/longitude for a
 * user: if the client cannot send a position, no version of this UI — or any
 * future one — can start storing one by accident.
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }
  const d = parsed.data;

  const city = d.mapCity?.trim() || null;
  const countryCode = city ? countryCodeFor(d.mapCountry ?? null) : null;
  const point = resolveUserPoint(city, countryCode);

  // Going hidden clears the stored point as well as the flag. Leaving stale
  // coordinates on a hidden account means the data is still there for the next
  // query that forgets the filter — so there is nothing left to forget.
  const clearing = d.mapVisibility === "HIDDEN";

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      mapVisibility: d.mapVisibility,
      mapCity: clearing ? null : city,
      mapCountryCode: clearing ? null : countryCode,
      mapLat: clearing ? null : point.mapLat,
      mapLon: clearing ? null : point.mapLon,
      openToSpar: d.openToSpar ?? undefined,
      lookingForTraining: d.lookingForTraining ?? undefined,
    },
    select: {
      mapVisibility: true, mapCity: true, mapCountryCode: true,
      mapLat: true, mapLon: true, openToSpar: true, lookingForTraining: true,
    },
  });

  return NextResponse.json({
    settings: updated,
    onMap: updated.mapVisibility !== "HIDDEN" && updated.mapLat !== null,
    // Told plainly, because "I turned it on but I'm not there" is the single
    // most likely confusion in this whole feature.
    warning:
      updated.mapVisibility !== "HIDDEN" && updated.mapLat === null
        ? city
          ? `We don't know where "${city}" is yet, so you won't appear on the map. Try the nearest major city.`
          : "Add your city to appear on the map."
        : null,
  });
}

export const dynamic = "force-dynamic";
