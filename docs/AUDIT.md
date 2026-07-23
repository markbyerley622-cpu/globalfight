# GlobalFight — Production Audit

**Date:** 2026-07-23 · **Commit baseline:** `main` @ perf(ux) layout-shift fix · **Method:** six parallel domain specialists (Security, Architecture/Perf, Database, API/Backend, UX/A11y/Onboarding, Code-Quality/CI), read-only, every finding tied to `file:line`. No code changed by the audit; nothing pushed.

**Scope:** `C:/Users/markb/Desktop/globalfight` — Next.js 15.1.4 (App Router), React 19, Prisma 6 / Postgres. ~61k LOC in `src` (625 files), 118 API routes, 66 pages, ~70 Prisma models.

---

## 0. One-paragraph verdict

This is a **well-engineered codebase with a thin safety net.** Code-level discipline is genuinely high: clean `tsc` (0 errors / 625 files), fail-closed startup and feature-flag guards, a single admin guard on every admin route, a stateless-JWT auth model with epoch revocation, parameterized SQL only, active SSRF defenses, a mostly well-indexed schema, and thoughtful UX (deliberate empty states, safe-area insets, gesture-gated permissions). The risk is **structural and concentrated**, not systemic rot: no CI gate and no tests on the money paths (picks/resolution/auth), a `prisma db push --accept-data-loss` deploy model, a **dead distributed cache** that breaks the moment you scale past one instance, a handful of **concrete correctness/security bugs** (stored XSS, no security headers, unthrottled signup, cascade-delete data loss, non-atomic ingest), and two **fully-built-but-invisible** features (in-app notifications, the notification bell). None of it is a rewrite. It is roughly **2–3 focused sprints** from production-hardened.

---

## 1. Executive Summary

**Top 10 things to fix, in priority order** (details in the numbered reports):

| # | Finding | Sev | Where | Report |
|---|---|---|---|---|
| 1 | Stored XSS via unescaped JSON-LD `</script>` (any signed-in user sets fighter name) | HIGH | `fighters/[slug]/page.tsx:110`, `news/[slug]/page.tsx:61` | Security |
| 2 | No security headers at all (no CSP/HSTS/X-Frame-Options/nosniff) | HIGH | `next.config.ts` (absent) | Security |
| 3 | `Fight.red`/`blue` `onDelete: Cascade` → deleting one fighter wipes shared bout history | HIGH | `schema.prisma:526-528` | Database |
| 4 | Redis cache is dead code (imports `ioredis`, ships `redis`) → divergent stale data at >1 instance | HIGH | `cache.ts:24-35` | Architecture |
| 5 | `/api/auth/signup` unthrottled (bcrypt-12 DoS) + email enumeration | HIGH | `auth/signup/route.ts` | API / Security |
| 6 | No CI gate; no tests on picks/resolution/auth | HIGH | no `.github/`, 7 tests all scrapers | Code-Quality |
| 7 | No error boundaries anywhere; every `force-dynamic` route is one DB hiccup from a blank screen | HIGH | no `**/error.tsx` | UX |
| 8 | Notification bell fully built but never mounted → in-app notifications invisible | HIGH | `notification-bell.tsx` (unreferenced) | UX |
| 9 | Missing hot-path indexes incl. North-Star WAPU metric | HIGH | `metrics.ts:75`, `resolve.ts:207`, `events-query.ts:93` | Database |
| 10 | `persist.ts` writes a fight card non-atomically (no `$transaction`) | HIGH | `persist.ts:157` | Database |

**Cross-cutting themes:** (a) *Safety net < code quality* — the code is better than the process protecting it. (b) *Built-but-dark features* — notification bell, `/predictions` flag-off dead-ends, the Redis path, three unused deps. (c) *Single-instance assumptions* — cache, in-memory feed stores, and cron overlap all work on one Render process and break on horizontal scale.

---

## 2. Security Audit

**No Critical.** Strong core: fail-closed `AUTH_SECRET` (`resolveAuthSecret`), bcrypt(12), tokenVersion session revocation, single admin guard across all 15 admin routes, signature-verified private evidence storage with uniform-404 IDOR protection, parameterized SQL only, SSRF-guarded image proxy, solid password-reset lifecycle (sha256 tokens, 256-bit entropy, single-use, 30-min expiry, `timingSafeEqual`, generic responses).

- **H-1 (High) Stored XSS — JSON-LD injection.** `JSON.stringify` doesn't escape `</script>`. Sink: `fighters/[slug]/page.tsx:110`, `news/[slug]/page.tsx:61`. Source: any signed-in user via `api/fighters/onboard/route.ts:23,29` (name length-checked only, no charset filter) or `api/profile/route.ts:48`. Fix: unicode-escape `<`,`>`,`&` before injection; add CSP.
- **H-2 (High) No security response headers.** `next.config.ts` has no `headers()`, no `middleware.ts`. Missing CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy. Compounds H-1 and enables clickjacking. Fix: add `headers()` with strict CSP + frame-ancestors none.
- **M-1 (Med) Signup no rate limit** — see API H1. **M-2 (Med) Email change with no re-auth/verification** (`auth/account/route.ts:36-42`) → account-takeover chain from H-1 (change email → password reset → seize).
- **L-1** non-constant-time secret compares (`cron-handler.ts:19`, `admin/rankings/generate/route.ts:16`, `admin/seed-world/reset/route.ts:23`). **L-2** dual cron-auth schemes. **L-3** content-creation routes unthrottled (`fighters/onboard`, `auth/account`).
- **Verified safe:** admin RBAC (all 15 routes gated), IDOR on evidence readers, SQL injection (all `$queryRaw` parameterized), upload SSRF/magic-byte/EXIF, password reset, CSRF (SameSite=Lax + JSON content-type on sensitive), secrets (no `NEXT_PUBLIC_*` leakage).

## 3. Architecture Audit

- **H1 (High) Redis cache dead.** `cache.ts:24-35` imports `"ioredis"`; `package.json` ships `redis@4`; import always `catch`→null, silent fallback to per-process `Map`. `cached()` fronts every hot read (`repo.ts:64-130`). Single Render instance OK; **>1 instance → isolated caches, `invalidate()` clears only local Map → divergent stale data.** Fix: rewrite `getRedis()` against `redis@4` API or install `ioredis`; log when `REDIS_URL` set but unavailable.
- **H3 (High) Repository boundary unenforced.** `repo.ts` claims "the ONLY surface the UI talks to," but 116 files import `prisma` incl. **34 route handlers + 11 server pages** (e.g. raw query mid-render `events/[slug]/page.tsx:124`). Caching/retry/visibility protect only some reads. Fix: ESLint boundary rule forbidding `@/lib/db` outside `**repo*.ts`/`services/**`; migrate top offenders.
- **M3 (Med) Two competing ingestion stacks** — dormant `services/providers+aggregator+sync` vs live `lib/scraper/*`; duplicate normalization (`services/normalization/names.ts` vs `scraper/*/normalize.ts`). Decide canonical path; label the other experimental.
- **M5** `repo.prisma.ts:22 export *` drags the 718-line forum repo into every importer.
- **L1** `SportbexProvider` defined but not in `PROVIDERS` (dead). **L5 good patterns:** `live()` cold-start retry, `cache()` session dedup, Leaflet SSR-disabled dynamic import, `sharp` externalized.

## 4. Backend Audit
(See API Audit, §7 — same specialist.) Backend logic is the strongest layer: single admin guard (pages 404 / handlers 403), optimistic-concurrency + audit-log transaction on every admin write (`lib/admin/events.ts`), rate limiter fails closed on Redis error and pairs IP+account keys, `withLease` DB lock proven, provider HTTP has timeout + bounded retry + `Retry-After`, UGC/media fail closed.

## 5. Frontend Audit

- **H2 (High) Client re-fetches session every page load.** `auth-client.tsx:49-65` mounts `user=null, loading=true` then fetches `/api/auth/me` in `useEffect`, discarding the server's already-resolved `getCurrentUser()`. **Root cause of the profile CLS 0.694** the recent commit only masked. Fix: resolve user in root server layout, pass `initialUser`, `useState(initialUser)`/`loading=false`.
- **H5 (High) One `next/dynamic` in the whole app** (`map-explorer.tsx:23`). The 618-line `reels-overlay` ships in the homepage bundle and mounts even when closed (`reels-launcher.tsx:5`). Same for `gym-gallery-manager` (534), `predictions-markets` (427), `profile-editor` (505), `thread-discussion` (409). Fix: `dynamic()` + render only when open.
- **M4** `AuthProvider` value is a fresh object each render (`auth-client.tsx:96-99`) → every `useAuth()` consumer re-renders; wrap in `useMemo`.
- **L2** 7 raw `<img>`; `home/hero.tsx:184` (`cr-logo.png`) on the LCP path lacks dimensions. **L3** `/fighters` first page fetched client-side (SEO/LCP cost).

## 6. Database Audit

- **Missing hot-path indexes** (biggest finding): `FightPick.updatedAt` (**North-Star WAPU**, `metrics.ts:75` — full scan every metrics load), `Fight.(result, picksResolvedAt)` (resolve cron `resolve.ts:207`), `Fight.createdAt` (return-engine `return-engine.ts:281`), `Event.countryCode` (schema indexes `country`, the wrong column — `events-query.ts:93`), fighter-name dedupe needs a `pg_trgm` GIN (`dedupe/fighters.ts:55`, run twice/bout/ingest), `User.createdAt`, `ForumThread.replyCount/reactionCount`. Add `FighterAlias @@unique([fighterId, normalized])`.
- **H (data loss) `Fight` cascades from both fighters** (`schema.prisma:526-528`) → delete one fighter erases every shared bout, cascading into picks/battles/odds/threads. Merges must re-point FKs; corners should be `Restrict`/`SetNull`.
- **H persist non-atomic** (`persist.ts:157`) — mid-card crash leaves half-persisted events. **H dedupe** — same-name fighters collapse into one slug (`persist.ts:84`); `take:50` candidate cap silently creates duplicates for common surnames (`dedupe/fighters.ts:55`).
- **M** `winnerId` no FK (holds id *or* slug); stringly-typed corners with no CHECK/enum.
- Unbounded `findMany` (no `take`): `metrics.ts:14`, `return-engine.ts:99-105`, `geo/people.ts:48-50`, `repo.prisma.ts:61`.
- Connection pooling: global singleton correct for single Render process; **if any route runs serverless, `DATABASE_URL` has no pooler/connection_limit → pool exhaustion** — use PgBouncer/Accelerate.

## 7. API Audit

118 route handlers, 0 server actions. Full endpoint inventory with auth/validation matrix is in the API specialist's notes. Findings:
- **H1 (High) `/api/auth/signup` no rate limit** — bcrypt-12 CPU-exhaustion DoS + unbounded account creation. Every other credential route is bounded. Fix: `hit()` on `clientIp` before hashing.
- **H2 (High) Signup email enumeration** (`signup/route.ts:54-56` returns 409 for existing email) — login was deliberately non-enumerating; signup isn't. Fix with H1.
- **M1** `contentReport` policy defined but not wired to `forums/report/route.ts` (flood the mod queue unbounded). **M2** side-effecting crons (`resolve-picks`, `return-engine`) have no overlap lease though `withLease` exists. **M3** image proxy follows redirects without re-validating the hop (`img/route.ts:42-52`) — SSRF to internal *image* endpoints. **M4** raw `Error.message` returned to clients + 500s mislabeled 400 (`feed/signal`, `forums/*`, `fights/[slug]/pick`).
- **L1** anonymous `cid`-keyed feed writes (horizontal access; in-memory, per-instance). **L4** cron fails open in non-prod with no secret — set `CRON_SECRET` in preview envs.
- Only 10/118 routes use zod, but no unvalidated *privileged* mutation found (admin/picks/onboarding validate in the lib layer).

## 8. Performance Audit

Consolidated from Architecture + DB + UX:
- **Bundle:** eager heavy client components (H5); 3 unused heavy deps (`motion`, `hls.js`, `next-themes`) still installed, `motion` still in `optimizePackageImports`.
- **Server render:** session double-fetch (H2); event-page waterfall — odds/coverage/videos await sequentially (`events/[slug]/page.tsx:62,73,83`) though independent; landing over-fetches all ~137 events with every bout then slices to 30 in JS (`page.tsx:27` → `repo.prisma.ts:455`).
- **DB:** missing hot indexes (§6) are the dominant server-time cost; ingest fighter-name seq-scans twice per bout.
- **Positive:** `/events` server-paginated, `cache()` dedup, cold-start retry, reduced-motion honored.

## 9. Mobile UX Audit

Dark-first mobile PWA, 5-pillar bottom nav. Safe-area insets, overflow discipline, swipe-nav guarding, optimistic UI all handled well.
- **H1** no error boundaries. **H2** notification bell never mounted. **M1** sub-44px touch targets on core controls (confidence stars `p-2`, map close `size-7`=28px, header icons `size-9`); `.tap` (`globals.css:703`) is press-animation only, no hit-area. **M2** shared `Sheet` has no focus trap / scroll lock / `aria-labelledby`. **M4** no `loading.tsx` on `/` and `/events` (entry points). **L3** hardcoded dark, no light theme.

## 10. Accessibility Audit

Strong: engineered contrast (`--color-fog` 4.64:1, `globals.css:45`), `aria-pressed`/`aria-current`/`role=progressbar` used correctly, icon buttons carry `aria-label`, decorative images `alt=""`, reduced-motion honored, functional skip link. Gaps: **M2** modal focus management, **M5** `AccountMenu` not fully keyboard-operable (no roving/arrow keys), **L2** duplicate skip links (`layout.tsx:91` + `app-shell.tsx:104`), touch-target sizes (M1).

## 11. Code Quality Audit

`tsc`: **0 errors** / 625 files. ESLint: **0 errors / 68 warnings** (react-hooks + `no-explicit-any` deliberately demoted to warn). `any`: 16. `@ts-ignore`: 0. TODO/FIXME/HACK: 1/0/0. Strong `startup-guard.ts` (fail-closed preflight) and `feature-flags.ts` (strict `=== "true"`, documented past bug). Gaps: **L2** tsconfig missing `noUncheckedIndexedAccess` (high value for scraper/parse code); **L3** 68 warnings with no `--max-warnings=0` ratchet incl. `set-state-in-effect` (`i18n.tsx:43`) and stale unused eslint-disables.

## 12. Technical Debt Report

- **Dead code/deps:** `motion`, `hls.js`, `next-themes` (0 imports); `SportbexProvider` (unregistered); `NotificationBell` (unmounted); `contentReport` policy (unwired). Remove or wire each.
- **Drift compensation:** `persist.ts:110-134`, `dedupe/*.ts:33-39` wrap additive-table writes in `try/catch` with "not migrated yet" comments; `schema.prisma:222-225` withholds columns to avoid prod 500s. All symptoms of `db push` with no migration history — retiring that model removes this whole class of defensive code.
- **Two ingestion stacks / two normalization impls** (M3) — ~25 dormant provider files duplicating the live scrapers' concern.
- Debt is remarkably low at the token level; the debt that exists is architectural/process.

## 13. Feature Gap Analysis

Bottom-up from the code (not the phases, which are blocked — §14): fully-built features not surfaced to users — in-app notifications (bell unmounted), `/predictions` (flag-off but linked from AccountMenu + ProfileView → dead-ends while `BoutPick` still works). Retention loop from onboarding auto-follow has **no visible output surface** without push. These are "finish the last mile," not "build."

## 14. Phase 1 vs Current — ⛔ BLOCKED

**No screenshots or phase-spec documents were provided, and none exist in the repo** (`docs/` holds only `SEED-WORLD.md`). This report cannot be produced from evidence. **Hypothesis to confirm:** the phases map to branches — `launch/phase1-retention`, `personalized-home`, `return-engine`, `community-loop` (retention/engagement) may be "Phase 1." Provide the Phase-1 screenshots/spec or confirm the branch mapping to unblock.

## 15. Phase 2 vs Current — ⛔ BLOCKED

Same blocker. **Hypothesis:** `feature/prediction-battles` (PvP predictions — per project memory a Phase-2 PvP sprint), `feature/admin-event-editor`, `feature/render-demo-world`. Provide screenshots/spec or confirm.

## 16. Combined Integration Strategy — ⛔ BLOCKED on §14/§15

Cannot design the merge without knowing the two phases' surfaces. What the audit *does* establish for whenever it unblocks: the merge must (a) route both phases' reads through the repository layer (H3) not new direct-Prisma pages, (b) reuse the existing `BoutPick`/`Sheet`/`EmptyState`/pillar-nav primitives rather than adding parallel ones, (c) surface both phases' outputs through the (to-be-mounted) notification system, and (d) land behind `feature-flags.ts` with the strict `=== "true"` semantics already in place.

## 17. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fighter delete/merge wipes bout history | Med (dedupe engine exists) | **Critical** (irreversible data loss) | Fix cascade (§6) before any merge feature |
| `db push --accept-data-loss` drops a prod column | Med | High | Move to `prisma migrate`; drop the flag now |
| Scale to >1 instance → stale/divergent cache | High if they scale | High | Fix Redis path (§3) before horizontal scale |
| Stored XSS exploited | Med | High (session-action abuse, admin) | Escape JSON-LD + CSP |
| Signup DoS / enumeration | Med | Med-High | Rate-limit + de-enumerate |
| Regression ships to live (no CI/tests) | High over time | High | CI gate + tests on money paths |
| Cron double-run mis-scores picks | Low (idempotent) | High | `withLease` belt-and-braces |

## 18. Production Readiness Score — **68 / 100**

| Dimension | Score | Rationale |
|---|---|---|
| Security | 74 | Strong core; XSS + no headers + signup drag it down |
| Architecture | 70 | Real seam, but unenforced + dead cache |
| Database (schema/query) | 72 | Well-indexed mostly; cascade + missing hot indexes + non-atomic |
| API / Backend | 82 | Best layer; edge gaps only |
| Frontend / Performance | 68 | Eager bundles, client session fetch, over-fetch |
| Mobile UX | 74 | Disciplined; error boundaries + bell + targets |
| Accessibility | 76 | Above average; focus mgmt + targets |
| Code Quality | 80 | Clean tsc, low debt, good guards |
| **Testing / CI** | **35** | No CI gate; zero tests on critical paths |
| Ops / Deploy | 55 | `--accept-data-loss`, dead cache at scale; evidence-bucket boot gate good |

**Composite 68/100 — "Solid pre-launch beta; not yet production-hardened."** Testing/CI and Ops are the anchors dragging an otherwise-70s codebase down. Clear the P0 wave and add a CI gate and this moves to the low-80s.

## 19. Estimated Engineering Timeline

- **Wave 0 (P0 ship-blockers): ~3–5 dev-days.** Mostly small, surgical, low-risk edits.
- **Wave 1 (P1 correctness/retention/perf): ~1.5–2 weeks.** Indexes, tests, CI, AuthProvider, dynamic imports, dedupe.
- **Wave 2 (P2 hardening/scale): ~1.5–2 weeks.** Migrations, repo-boundary enforcement, OAuth/guest, cleanup.
- **Product-phase integration (§14–16): unestimable until screenshots/specs provided.**

Total technical hardening to production-grade: **~4–5 weeks** of focused work, parallelizable across the waves.

## 20. Prioritized Implementation Roadmap

**Wave 0 — P0 (do before next real deploy / before scaling):**
1. Escape JSON-LD (Security H-1) + add security headers/CSP (H-2).
2. Rate-limit + de-enumerate `/api/auth/signup` (API H1/H2).
3. Change `Fight.red/blue` off `onDelete: Cascade` (DB) — data-loss guard.
4. Wrap `persist.ts` event/fighter writes in `$transaction` (DB).
5. Add `app/error.tsx` + `global-error.tsx` (UX H1).
6. Mount `<NotificationBell/>` for signed-in users (UX H2) — unlocks the retention loop.
7. Fix or remove the Redis path (Arch H1); drop `--accept-data-loss` from the Render build.

**Wave 1 — P1 (correctness, retention, perf):**
8. Add hot-path indexes (WAPU `FightPick.updatedAt`, `Fight.(result,picksResolvedAt)`, `Fight.createdAt`, `Event.countryCode`, fighter trigram).
9. Fix dedupe: raise `take:50` via indexed `nameKey`; disambiguate same-name slugs.
10. Seed `AuthProvider` from server layout + `useMemo` value (Arch H2/M4) — kills profile CLS + a round-trip/nav.
11. `dynamic()` the heavy modals (Reels, editors, markets) (Arch H5).
12. Add `.github/workflows/ci.yml` (typecheck+lint+test); tests for `resolve.ts`, `picks.ts`, auth (Code-Quality H1/H2).
13. Wire `contentReport` into `forums/report`; `withLease` on `resolve-picks`/`return-engine`; re-validate image-proxy redirects; standardize catch-all errors + pino redact.
14. Email-change re-auth/verification (Security M-2).
15. UX: real 44px targets (`.tap`), `Sheet` focus trap + scroll lock, `loading.tsx` for `/` + `/events`, repoint Profile→Notifications to `/profile/edit`.
16. Onboarding: resolve `/predictions` dead-ends, permission priming, resume-on-login.

**Wave 2 — P2 (hardening, scale, DX):**
17. Adopt `prisma migrate` (baseline + `migrate deploy` in CI); remove drift `try/catch`.
18. ESLint repo-boundary rule; migrate the 34 route + 11 page direct-Prisma offenders.
19. Remove dead deps (`motion`, `hls.js`, `next-themes`); `noUncheckedIndexedAccess`; regenerate `.env.example` (56 undocumented vars).
20. OAuth/guest signup; lighten the signup role-picker (asked twice); light-theme decision; unbounded `findMany` caps.

---

*Implementation is gated on your approval of this roadmap. The product-integration half (§14–16) is blocked pending Phase-1/Phase-2 screenshots or confirmation of the branch mapping.*
