// Client- AND server-safe half of identity verification.
//
// `identity-verification.ts` is `server-only` (it touches Prisma and the private
// object store), but the account banner is a client component and needs to ask
// the one question "does this role verify?". Rather than duplicate that rule —
// which is exactly how the role list drifted into three copies before — the
// predicates live here and the server module re-exports them.
//
// Nothing in this file may import prisma, the evidence store, or env.

import { REGISTRY_ROLE_DEFS } from "@/lib/roles";

export type VerificationStatus = "PENDING" | "APPROVED" | "DECLINED" | "RESUBMIT_REQUESTED";
export type DocumentKind = "FRONT" | "BACK" | "SUPPORTING";

/**
 * "Fan" is the only role that needs nothing. Every other registry role makes a
 * claim about who someone is professionally, so every other role can verify.
 *
 * Derived from the single role list rather than duplicated as a second array —
 * adding a role to `roles.ts` must not silently create an unverifiable one.
 */
export function isProfessionalRole(role: string): boolean {
  return role !== "fan" && REGISTRY_ROLE_DEFS.some((r) => r.value === role);
}

export function roleLabel(role: string): string {
  return REGISTRY_ROLE_DEFS.find((r) => r.value === role)?.label ?? role;
}

/** A user may hold exactly one open request at a time. */
export function isOpen(status: string): boolean {
  return status === "PENDING";
}
