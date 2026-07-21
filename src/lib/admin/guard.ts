import "server-only";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

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

/** Staff = full admin, or a moderator doing day-to-day operations. */
export function isAdminRole(role: string): boolean {
  return role === "ADMIN" || role === "MODERATOR";
}

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
