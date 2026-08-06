// ════════════════════════════════════════════════════════════════════════════
//  Service refusals that carry their own HTTP status.
//
//  The convention in this codebase is that a service function throws an Error
//  whose message is safe to show a user, and the route passes it through — safe
//  only because ORM errors are prevented at the source (CLAUDE.md rules 4 and
//  5). That works, but it flattens every refusal to 400, and the access-control
//  matrix in CLAUDE.md is specific: a non-owner edit is 403, a resource the
//  caller may not know exists is 404.
//
//  So the message convention is kept exactly as it is, and a status is carried
//  alongside it. Nothing else changes: a plain Error thrown anywhere in this
//  domain still becomes a 400 with its own text.
// ════════════════════════════════════════════════════════════════════════════

export class PostError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PostError";
    this.status = status;
  }
}

/** The caller may not do this, and we are willing to say so. */
export const forbidden = (message: string) => new PostError(message, 403);

/**
 * It does not exist, OR it does and the caller has no business knowing.
 *
 * Deliberately one function for both. A MEMBERS-only post that answered 403 to
 * a stranger holding its id would confirm the post exists — the existence
 * oracle CLAUDE.md rule 6 exists to close.
 */
export const notFound = (message = "That post no longer exists.") => new PostError(message, 404);

/** The state changed under the caller (already deleted, already attached). */
export const conflict = (message: string) => new PostError(message, 409);

/** Map any thrown value to a response body + status. */
export function refusalOf(e: unknown): { error: string; status: number } {
  if (e instanceof PostError) return { error: e.message, status: e.status };
  if (e instanceof Error && e.message) return { error: e.message, status: 400 };
  return { error: "Something went wrong.", status: 500 };
}
