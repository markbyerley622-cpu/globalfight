import { NextResponse } from "next/server";
import { spawn } from "node:child_process";

// POST /api/admin/seed-world/reset  (Authorization: Bearer <SEED_WORLD_ADMIN_TOKEN>)
//
// Removes every seeded object (all @seed.local users → cascades their picks,
// comments, cards, notifications, activity, reactions, threads; plus their
// analytics rows; then repairs thread counters). Never touches real accounts.
//
// Works regardless of SEED_WORLD_MODE — so you can turn the mode off (which leaves
// the data in place, by design) and then clean it up explicitly when ready.
// SPAWNS the guarded script rather than importing it, so no seed code enters the
// app bundle. Inert (404) unless SEED_WORLD_ADMIN_TOKEN is configured.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = process.env.SEED_WORLD_ADMIN_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!provided || provided !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "prisma/seed/demo.mts", "wipe"], {
      cwd: process.cwd(),
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, out: out.slice(-6000) }));
    child.on("error", (e) => resolve({ code: 1, out: String(e) }));
  });

  return NextResponse.json(
    { ok: result.code === 0, exitCode: result.code, log: result.out },
    { status: result.code === 0 ? 200 : 500 },
  );
}
