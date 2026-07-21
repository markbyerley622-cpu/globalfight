import "server-only";

// Demo mode is driven by the master switch, ALLOW_SEED_WORLD, read at runtime on
// the server. When demo data is permitted to exist, the transparent Demo World
// badge + footer MUST show — a visitor is never shown simulated people without
// being told. Reading the same switch that governs the data is deliberate: the
// badge cannot drift out of sync with whether fake accounts are present.
// (Server-only: client components receive this as a prop from a server parent.)
export function isDemoMode(): boolean {
  return (process.env.ALLOW_SEED_WORLD ?? "").trim().toLowerCase() === "true";
}
