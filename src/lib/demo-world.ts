import "server-only";

// Demo mode is driven by the SINGLE source of truth, SEED_WORLD_MODE, read at
// runtime on the server. "demo" → the transparent Demo World badge + footer show.
// (Server-only: client components receive this as a prop from a server parent.)
export function isDemoMode(): boolean {
  return process.env.SEED_WORLD_MODE === "demo";
}
