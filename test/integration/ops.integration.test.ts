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
  // The route sends "no-store, max-age=0". Asserted as a SUBSTRING rather than
  // an exact string: what matters is that a health check is never cached, and
  // pinning the exact header made this test fail the moment the route added the
  // (strictly stronger) max-age=0 — a broken test reporting a fixed behaviour.
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
});
