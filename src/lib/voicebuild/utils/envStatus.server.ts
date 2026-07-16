import "server-only";

// Server-only env helpers. Never returns values — only presence — so nothing
// secret can leak toward the client through these.

export function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function missingFrom(names: string[]): string[] {
  return names.filter((n) => !present(n));
}

export function flag(name: string): boolean {
  return (process.env[name] || "").trim().toLowerCase() === "true";
}

export function value(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}
