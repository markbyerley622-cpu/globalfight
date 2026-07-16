import { prisma } from "@/lib/db";
import { deleteStored } from "@/lib/images/store";
import { plog } from "@/features/predictions/logger";

const log = plog.child({ mod: "scrub-photos" });

/** Hosts you hold a licence/attribution for (LICENSED_IMAGE_HOSTS, comma-sep). */
function licensedHosts(): string[] {
  return (process.env.LICENSED_IMAGE_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isLicensed(url: string | null, allow: string[]): boolean {
  if (!url) return true; // already empty
  if (allow.length === 0) return false; // nothing licensed → everything drops
  try {
    const host = new URL(url, "https://placeholder.invalid").hostname.toLowerCase();
    return allow.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export type ScrubResult = { total: number; affected: number; updated: number; filesDeleted: number };

/**
 * Drop unlicensed re-hosted fighter photos to placeholder. Nulls
 * imageUrl/thumbUrl/heroImageUrl for any photo not on a licensed host. With
 * `deleteFiles`, also removes the underlying file from our storage (R2 / Blob /
 * local) — external hosts are left untouched. Idempotent.
 */
export async function scrubUnlicensedPhotos(opts: { apply: boolean; deleteFiles?: boolean }): Promise<ScrubResult> {
  const allow = licensedHosts();
  const fighters = await prisma.fighter.findMany({
    select: { id: true, imageUrl: true, thumbUrl: true, heroImageUrl: true },
  });

  const affected = fighters.filter(
    (f) => !isLicensed(f.imageUrl, allow) || !isLicensed(f.thumbUrl, allow) || !isLicensed(f.heroImageUrl, allow),
  ).length;

  const res: ScrubResult = { total: fighters.length, affected, updated: 0, filesDeleted: 0 };
  if (!opts.apply) return res;

  for (const f of fighters) {
    const data: { imageUrl?: null; thumbUrl?: null; heroImageUrl?: null } = {};
    const drops: string[] = [];
    for (const field of ["imageUrl", "thumbUrl", "heroImageUrl"] as const) {
      const url = f[field];
      if (!isLicensed(url, allow)) {
        data[field] = null;
        if (url) drops.push(url);
      }
    }
    if (Object.keys(data).length === 0) continue;

    await prisma.fighter.update({ where: { id: f.id }, data });
    res.updated++;

    if (opts.deleteFiles) {
      // De-dupe the same URL used across variants.
      for (const url of [...new Set(drops)]) {
        if (await deleteStored(url)) res.filesDeleted++;
      }
    }
  }

  log.info(res, "scrub complete");
  return res;
}
