/**
 * The session cookie's NAME, and nothing else.
 *
 * It lives in its own module because `middleware.ts` needs it and cannot import
 * `lib/auth` — that module is `server-only` and pulls in bcrypt and Prisma,
 * neither of which runs on the edge runtime. Re-typing the string in the
 * middleware would work right up until somebody renamed the cookie in one place,
 * at which point every member would silently start getting the signed-out
 * routing. One constant, two importers.
 *
 * Deliberately carries no logic and no secret: knowing the cookie's name grants
 * nothing. Reading, verifying and trusting it all still happen in `lib/auth`.
 */
export const SESSION_COOKIE = "cr_session";
