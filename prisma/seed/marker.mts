import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A tiny ephemeral marker so `refresh` runs at most once per deploy. Render's
// filesystem is fresh on each deploy, so a redeploy re-arms refresh naturally;
// within a deploy the marker prevents re-wiping on every instance restart.
const FILE = join(tmpdir(), "combatreviews-seed-world.json");

export interface SeedMarker {
  deploy?: string; // RENDER_GIT_COMMIT (or "manual")
  generatedAt?: string; // ISO
  mode?: string;
}

export function readMarker(): SeedMarker | null {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as SeedMarker;
  } catch {
    return null;
  }
}

export function writeMarker(m: SeedMarker): void {
  try {
    writeFileSync(FILE, JSON.stringify(m, null, 2), "utf8");
  } catch {
    /* best-effort — a missing marker only means refresh may re-run; never fatal */
  }
}

/** Drop the marker after a purge, so re-enabling the seed world seeds again
 *  rather than believing this deploy had already been refreshed. */
export function clearMarker(): void {
  try {
    rmSync(FILE, { force: true });
  } catch {
    /* best-effort — same non-fatal contract as writeMarker */
  }
}

export const deployId = (): string => process.env.RENDER_GIT_COMMIT ?? process.env.RENDER_INSTANCE_ID ?? "manual";
