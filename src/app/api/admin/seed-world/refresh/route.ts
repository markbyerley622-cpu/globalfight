import { NextResponse } from "next/server";
import { spawn } from "node:child_process";

// POST /api/admin/seed-world/refresh  (Bearer <SEED_WORLD_ADMIN_TOKEN>)
//
// Wipes and regenerates the demo world on the demo service. Triple-gated:
//   1. SEED_WORLD_ADMIN_TOKEN must be configured (else the route is 404 — inert).
//   2. SEED_WORLD_MODE must be demo|refresh (off on production → 403).
//   3. The Bearer token must match.
// It SPAWNS the guarded seed script (prisma/seed/demo.mts) rather than importing
// it, so no seed code is ever bundled into the app — and the script re-checks the
// host allowlist, so even here the production DB cannot be seeded.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = process.env.SEED_WORLD_ADMIN_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mode = (process.env.SEED_WORLD_MODE ?? "off").toLowerCase();
  if (mode !== "demo" && mode !== "refresh") {
    return NextResponse.json({ error: "Seed World is off in this environment." }, { status: 403 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!provided || provided !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "prisma/seed/demo.mts", "refresh"], {
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
