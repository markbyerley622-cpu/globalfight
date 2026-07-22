import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { uniqueGymSlug, setGymMembership } from "@/lib/geo/gyms";
import { resolvePoint, countryCodeFor } from "@/lib/geo/gazetteer";

const DISCIPLINES_MAX = 12;

const Create = z.object({
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().min(1).max(80),
  country: z.string().trim().min(2).max(80),
  address: z.string().trim().max(160).optional(),
  disciplines: z.array(z.string().trim().min(1).max(40)).max(DISCIPLINES_MAX).default([]),
  website: z.string().trim().url().max(200).optional().or(z.literal("")),
  instagram: z.string().trim().max(80).optional(),
  description: z.string().trim().max(600).optional(),
  hoursNote: z.string().trim().max(160).optional(),
  /** Join it as your home gym as part of creating it — the common case. */
  makeHome: z.boolean().default(true),
});

/** Search gyms — used by the onboarding "choose your gym" picker. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const gyms = await prisma.gym.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
    orderBy: [{ verified: "desc" }, { memberCount: "desc" }],
    take: 20,
    select: {
      id: true, slug: true, name: true, city: true, country: true,
      logoUrl: true, verified: true, memberCount: true, disciplines: true,
    },
  });
  return NextResponse.json({ gyms });
}

/**
 * Create a gym.
 *
 * Creating is NOT claiming: the creator becomes a member (and optionally sets
 * it as their home gym) but the page stays UNVERIFIED and OWNERLESS. Ownership
 * only ever comes from a reviewed GymClaim — otherwise "create a gym" is a
 * self-service way to own someone else's business page.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to add a gym." }, { status: 401 });

  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }
  const d = parsed.data;

  const duplicate = await prisma.gym.findFirst({
    where: { name: { equals: d.name, mode: "insensitive" }, city: { equals: d.city, mode: "insensitive" } },
    select: { slug: true, name: true },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: `${duplicate.name} already exists in ${d.city}.`, existing: duplicate.slug },
      { status: 409 },
    );
  }

  const countryCode = countryCodeFor(d.country);
  // City-level coordinates now so the pin appears immediately; a real address
  // geocode can overwrite latitude/longitude later without touching this row's
  // shape.
  const point = resolvePoint({ city: d.city, country: d.country, countryCode });

  const gym = await prisma.gym.create({
    data: {
      slug: await uniqueGymSlug(d.name),
      name: d.name,
      description: d.description || null,
      address: d.address || null,
      city: d.city,
      country: d.country,
      countryCode,
      latitude: null, // reserved for a real address geocode — not a city centre
      longitude: null,
      disciplines: d.disciplines,
      website: d.website || null,
      instagram: d.instagram || null,
      hoursNote: d.hoursNote || null,
      createdById: user.id,
    },
    select: { id: true, slug: true, name: true },
  });

  await setGymMembership({ userId: user.id, gymId: gym.id, join: true, isHome: d.makeHome });

  return NextResponse.json({ gym, pinned: !!point }, { status: 201 });
}

export const dynamic = "force-dynamic";
