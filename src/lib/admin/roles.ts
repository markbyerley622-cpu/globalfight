// ════════════════════════════════════════════════════════════════════════════
//  Who counts as staff. THE definition — everything else re-exports this one.
//
//  ── Why it is not in guard.ts any more ───────────────────────────────────
//  It still IS, as far as every caller is concerned: guard.ts re-exports it, so
//  nothing changed for the six admin pages and routes that import it there.
//
//  What changed is that guard.ts imports `next/navigation` (it renders a 404 for
//  a page), and `next/navigation` pulls in React client context. So importing
//  the one-line role predicate dragged the whole App Router client runtime in
//  with it, and any code that is NOT running inside a Next render — an
//  integration test, a script, a future queue worker — crashed on
//  `React.createContext is not a function` before it could ask a question as
//  simple as "is this user a moderator?".
//
//  A pure predicate belongs in a leaf module with no framework in it. This is
//  that module, and it is the only place the rule is written.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Staff = full admin, or a moderator doing day-to-day operations.
 *
 * Takes `User.role`, NEVER `registryRole` — that one is a self-declared label
 * with no privilege attached (see CLAUDE.md).
 */
export function isAdminRole(role: string): boolean {
  return role === "ADMIN" || role === "MODERATOR";
}
