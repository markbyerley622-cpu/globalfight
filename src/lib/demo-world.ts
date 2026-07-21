// True only on the demo Render service, where NEXT_PUBLIC_SEED_WORLD is set at
// build time. Unset (production, local) → false, so every demo indicator
// disappears automatically. Inlined by Next at build, safe in client + server.
export const DEMO_WORLD =
  process.env.NEXT_PUBLIC_SEED_WORLD === "on" || process.env.NEXT_PUBLIC_SEED_WORLD === "demo";
