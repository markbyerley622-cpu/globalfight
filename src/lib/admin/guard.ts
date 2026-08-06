import "server-only";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "./roles";

// ════════════════════════════════════════════════════════════════════════════
//  Admin access — ONE definition.
//
//  `role === "ADMIN" || role === "MODERATOR"` was written out by hand in every
//  admin page and every admin route handler. Six copies of an authorisation
//  rule is six places for it to drift, and the one that drifts is the one that
//  gets it wrong.
//
//  Pages 404 rather than 403: a 403 confirms the route exists to someone who
//  should not know that. Route handlers return 403 because the caller is
//  already authenticated code, not a browser probing for surfaces.
// ════════════════════════════════════════════════════════════════════════════

export type AdminUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

// The rule itself now lives in ./roles, which imports nothing. Re-exported here
// so every existing caller is unchanged, while code that runs OUTSIDE a Next
// render (tests, scripts, workers) can ask the same question without dragging
// `next/navigation` and the React client runtime in behind it.
export { isAdminRole };

/** For PAGES. Renders 404 for anyone who isn't staff. */
export async function requireAdminPage(): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) notFound();
  return user;
}

/** For ROUTE HANDLERS. Returns the user, or null when the caller must be refused. */
export async function requireAdminApi(): Promise<AdminUser | null> {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return null;
  return user;
}
