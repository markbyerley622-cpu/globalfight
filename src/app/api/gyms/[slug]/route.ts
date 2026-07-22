import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { countryCodeFor } from "@/lib/geo/gazetteer";

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
  phone: optionalText(40),
  email: optionalText(120),
  hoursNote: optionalText(160),
  disciplines: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

async function authorise(slug: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in." }, { status: 401 }) };
  const gym = await prisma.gym.findUnique({
    where: { slug },
    select: { id: true, ownerId: true, city: true, country: true, countryCode: true },
  });
  if (!gym) return { error: NextResponse.json({ error: "No such gym." }, { status: 404 }) };
  if (gym.ownerId !== user.id && !isAdminRole(user.role)) {
    return { error: NextResponse.json({ error: "You don't manage this gym." }, { status: 403 }) };
  }
  return { gym, user };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorise(slug);
  if ("error" in auth) return auth.error;
  const { gym } = auth;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }
  const d = parsed.data;

  // Moving a gym between cities must move its pin too, or the map keeps
  // pointing at the old town.
  const movingCity = d.city !== undefined || d.country !== undefined;
  const countryCode = movingCity
    ? countryCodeFor(d.country !== undefined ? d.country : gym.country)
    : undefined;

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
      phone: d.phone,
      email: d.email,
      hoursNote: d.hoursNote,
      disciplines: d.disciplines,
    },
    select: {
      slug: true, name: true, description: true, address: true, city: true, country: true,
      website: true, instagram: true, phone: true, email: true, hoursNote: true,
      disciplines: true, verified: true, memberCount: true, logoUrl: true, heroUrl: true,
    },
  });

  return NextResponse.json({ gym: updated });
}

export const dynamic = "force-dynamic";
