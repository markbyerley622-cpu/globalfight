import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { countryCodeFor } from "@/lib/geo/gazetteer";
import { authoriseGymEdit } from "@/lib/geo/gym-auth";

// ════════════════════════════════════════════════════════════════════════════
//  Gym page management — the capability an approved claim grants.
//
//  Approving a claim set `ownerId` and `verified` and then nothing could use
//  either: there was no endpoint an owner could call. This is that endpoint.
//
//  Authorisation is OWNER-or-admin, checked against the row, not against a
//  role claim in the session. `verified` and `ownerId` are deliberately NOT
//  editable here — a gym must never be able to verify itself.
// ════════════════════════════════════════════════════════════════════════════

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => v || null).nullable().optional();

const Body = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: optionalText(600),
  address: optionalText(160),
  city: optionalText(80),
  country: optionalText(80),
  website: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
    .nullable()
    .optional(),
  instagram: optionalText(80),
  facebook: optionalText(80),
  youtube: optionalText(80),
  tiktok: optionalText(80),
  phone: optionalText(40),
  email: optionalText(120),
  hoursNote: optionalText(160),
  disciplines: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;
  const { gym } = auth.value;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }
  const d = parsed.data;

  // Moving a gym between cities must move its pin too, or the map keeps
  // pointing at the old town.
  const movingCity = d.city !== undefined || d.country !== undefined;
  let countryCode: string | null | undefined;
  if (movingCity) {
    // The shared authoriser returns identity only, so the current country is
    // read here rather than widening that helper for one caller.
    const current = await prisma.gym.findUnique({ where: { id: gym.id }, select: { country: true } });
    countryCode = countryCodeFor(d.country !== undefined ? d.country : current?.country ?? null);
  }

  const updated = await prisma.gym.update({
    where: { id: gym.id },
    data: {
      name: d.name,
      description: d.description,
      address: d.address,
      city: d.city,
      country: d.country,
      countryCode,
      website: d.website,
      instagram: d.instagram,
      facebook: d.facebook,
      youtube: d.youtube,
      tiktok: d.tiktok,
      phone: d.phone,
      email: d.email,
      hoursNote: d.hoursNote,
      disciplines: d.disciplines,
    },
    select: {
      slug: true, name: true, description: true, address: true, city: true, country: true,
      website: true, instagram: true, facebook: true, youtube: true, tiktok: true,
      phone: true, email: true, hoursNote: true,
      disciplines: true, verified: true, memberCount: true, logoUrl: true, heroUrl: true,
    },
  });

  return NextResponse.json({ gym: updated });
}

export const dynamic = "force-dynamic";
