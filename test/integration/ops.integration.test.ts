import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { GET as health } from "@/app/api/health/route";

after(async () => { await prisma.$disconnect(); });

test("/api/health reports ok with a reachable database", async () => {
  const res = await health();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.db, "up");
  assert.equal(res.headers.get("cache-control"), "no-store");
});
