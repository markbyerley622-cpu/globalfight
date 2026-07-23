# GlobalFight — Hardening Log

Living record of the production-hardening effort tracked against `docs/AUDIT.md`.
Branch: `harden/wave0-production-blockers`. **Not pushed, not merged, not deployed.**

**Readiness: 68 → ~88 / 100** (Wave 0 complete; Wave 1 nearly complete; Wave 2 in
progress). The remaining gap to 95 is the repo-boundary migration, integration
tests, remaining UX/a11y polish, and Waves 3–5 (see AUDIT.md §18–20).

Verification legend: TSC = `tsc --noEmit` (0 errors), LINT = `eslint` (0 errors),
BUILD = `next build` (exit 0, 58/58 pages), RUNTIME = targeted node check.

---

## Wave 0 — Production Blockers (in progress)

Score movement this wave: **68 → ~78**. Six of seven identified P0 blockers landed;
two items were re-triaged (one done differently, two deferred with rationale below).

| # | Fix | Commit | Verify | Status |
|---|---|---|---|---|
| 1 | Escape JSON-LD (stored XSS) | `5b1b694` | TSC·LINT·RUNTIME·BUILD | ✅ done |
| 2 | Security headers + CSP (Report-Only) | `ec4b34f` | BUILD | ✅ done |
| 3 | Fight corners `onDelete: Restrict` | `17adab4` | prisma validate·BUILD | ✅ done (needs `db push`) |
| 5 | Signup rate-limit + de-enumeration | `33dfccd` | TSC·LINT·BUILD | ✅ done |
| 6 | Route + global error boundaries | `65a1f3c` | TSC·LINT·BUILD | ✅ done |
| 7 | Redis cache (node-redis v4) | `3d166de` | TSC·LINT·RUNTIME·BUILD | ✅ done |
| 4 | `persist.ts` atomicity | — | — | ⏭ deferred → Wave 1 |
| 7b | Drop `--accept-data-loss` | — | — | ⏭ deferred → Wave 1 |

---

### Fix 1 — Stored XSS via unescaped JSON-LD  ·  commit `5b1b694`
**Problem.** User-controlled fields rendered into `application/ld+json` `<script>` blocks could break out and inject markup. (Audit: Security H-1.)
**Root cause.** `JSON.stringify` does not escape `<`, `>`, `&`, or U+2028/U+2029. A fighter name set via `/api/fighters/onboard` (length-checked only) reaches `fighters/[slug]/page.tsx:110`; article author reaches `news/[slug]/page.tsx:61`. No CSP as backstop.
**Files changed.** `+src/components/seo/json-ld.tsx` (shared `<JsonLd>`), `src/app/fighters/[slug]/page.tsx`, `src/app/news/[slug]/page.tsx`.
**Why this solution.** One escaping choke-point both pages route through; `\u`-escaping keeps valid, losslessly-parsing JSON (vs. stripping characters or a heavy sanitizer).
**Alternatives considered.** DOMPurify (overkill, wrong tool for JSON-LD); removing JSON-LD (loses SEO). Rejected.
**Risks.** None functional — output round-trips identically. Depends on future authors using `<JsonLd>` not hand-rolled scripts (noted in the component).
**Validation.** RUNTIME check proved no raw `<`/`</script>` in output and lossless round-trip; TSC/LINT/BUILD clean. Only 2 pre-existing (unrelated) lint warnings remain in the fighter page — swept in Wave 1.
**Performance impact.** Negligible (one regex pass over a small string).
**Security impact.** Closes the stored-XSS sink. CSP (Fix 2) adds defense-in-depth.
**Rollback.** Revert the commit; no data/schema change.

### Fix 2 — Security headers + CSP (Report-Only)  ·  commit `ec4b34f`
**Problem.** Zero security response headers (no CSP/HSTS/X-Frame-Options/nosniff). (Audit: Security H-2.)
**Root cause.** `next.config.ts` had no `headers()`, no `middleware.ts`.
**Files changed.** `next.config.ts` (`async headers()`).
**Why this solution.** Enforce the unambiguously-safe headers now; ship CSP **Report-Only** first because a strict enforced CSP on Next needs per-request nonces and can white-screen the app. Observe reports, then enforce (Wave 1).
**Alternatives considered.** Enforced CSP with `'unsafe-inline'` (weak, false security); nonce middleware now (larger change, higher risk for Wave 0). Deferred the nonce work.
**Risks.** Report-Only CSP cannot break rendering. HSTS is ignored by browsers on http/localhost, safe in dev. `Permissions-Policy` keeps `geolocation=(self)` because `/map` uses `navigator.geolocation`.
**Validation.** BUILD exit 0; config accepted.
**Performance impact.** None (static response headers).
**Security impact.** Clickjacking (frame-ancestors/X-Frame-Options), MIME-sniffing, referrer leakage, transport downgrade all addressed; CSP telemetry begins.
**Rollback.** Revert the commit.

### Fix 3 — Fight corners `onDelete: Restrict`  ·  commit `17adab4`
**Problem.** Deleting one fighter cascaded away every shared bout, corrupting the opponent's record and cascading into picks/battles/odds. (Audit: Database HIGH.)
**Root cause.** `schema.prisma:526-528` set `onDelete: Cascade` on both `Fight.red`/`blue`.
**Files changed.** `prisma/schema.prisma`.
**Why this solution.** `redId`/`blueId` are non-null, so `SetNull` is impossible; `Restrict` makes the DB refuse a fighter delete until the bout FKs are re-pointed — exactly the safety a future merge needs. Zero `fighter.delete` call sites, so nothing breaks today.
**Alternatives considered.** Application-layer guard only (weaker — doesn't protect Prisma Studio / manual deletes). Rejected.
**Risks.** Takes effect only on next `prisma db push` (a non-destructive FK alter). Until then prod retains Cascade. **Action:** verify the alter on the next deploy.
**Validation.** `prisma validate` ✅; BUILD ✅. Confirmed the other `Cascade` relations are on owned child rows (aliases/titles/rankings) where cascade is correct.
**Performance impact.** None.
**Security/data impact.** Removes an irreversible data-loss path.
**Rollback.** Revert; re-push.

### Fix 5 — Signup rate-limit + de-enumeration  ·  commit `33dfccd`
**Problem.** `/api/auth/signup` had no throttle: bcrypt(12) CPU-exhaustion DoS + membership enumeration via the 409 oracle at speed. (Audit: API H1/H2, Security M-1.)
**Root cause.** Signup was the only credential route missing a `hit()` gate.
**Files changed.** `src/lib/rate-limit/index.ts` (`POLICY.signup` 8/h), `src/app/api/auth/signup/route.ts` (IP gate before any bcrypt/DB work; pin `runtime=nodejs`).
**Why this solution.** Per-IP gate before the expensive path kills both the DoS and the high-speed oracle, mirroring `login`. Kept the informative 409 (standard UX); full de-enumeration needs the email-confirm flow — folded into Wave 1 (Security M-2).
**Alternatives considered.** Generic "check your inbox" response now — requires an email provider that may be unset (would 503). Deferred.
**Risks.** Legitimate users behind shared NAT share the 8/h budget — generous for humans, and the window is 1h.
**Validation.** TSC/LINT/BUILD clean.
**Performance impact.** Adds one rate-limit lookup; removes a DoS lever.
**Security impact.** Closes the DoS and bounds enumeration to 8/h/IP.
**Rollback.** Revert both files.

### Fix 6 — Error boundaries  ·  commit `65a1f3c`
**Problem.** No error boundaries; any fault on a `force-dynamic` route showed Next's raw/blank error screen with no recovery. (Audit: UX H1.)
**Root cause.** No `app/error.tsx` / `app/global-error.tsx`.
**Files changed.** `+src/app/error.tsx`, `+src/app/global-error.tsx`.
**Why this solution.** Segment boundary (branded, logs `digest`, `reset()`), plus a self-contained global boundary with inlined styles for a root-layout crash (can't assume CSS is present).
**Alternatives considered.** Per-segment boundaries for `/map`, `/events` — good Wave-1 refinement, not required for the baseline.
**Risks.** None (purely additive).
**Validation.** TSC/LINT/BUILD clean; both compiled as client components.
**Performance impact.** None on the happy path.
**Security impact.** Stops raw error/stack disclosure on unhandled faults.
**Rollback.** Delete the two files.

### Fix 7 — Redis cache connects (node-redis v4)  ·  commit `3d166de`
**Problem.** The distributed cache never engaged; at >1 instance each process would serve a divergent cache with no cross-instance invalidation. (Audit: Architecture H1.)
**Root cause.** `cache.ts` dynamically imported `ioredis` (not installed) → always caught to null → silent per-process `Map` fallback. Even the call shape was ioredis-specific.
**Files changed.** `src/lib/cache.ts`.
**Why this solution.** Rewrite `getRedis()` against the installed `redis` v4 (`createClient`/`{EX}`), memoize one connection, normalize to a small adapter so `cached()`/`invalidate()` stay unchanged, and **log loudly** when `REDIS_URL` is set but Redis is unreachable so the fallback can never be silent again.
**Alternatives considered.** `npm i ioredis` to match the old code — adds a dep for a package already covered by `redis`. Rejected.
**Risks.** Locally `REDIS_URL` is unset → unchanged Map behavior (safe). In prod it now actually connects; a bad `REDIS_URL` degrades to Map + logs (does not 500).
**Validation.** RUNTIME (`createClient` reachable via dynamic import), TSC/LINT/BUILD clean.
**Performance impact.** Enables real cross-instance caching once `REDIS_URL` is set; no regression when unset.
**Security impact.** None.
**Rollback.** Revert the commit.

---

## Deferred with rationale (moved to Wave 1)

### Fix 4 — `persist.ts` atomicity (deferred)
The per-fight `try/catch` at `persist.ts:216` is deliberate — one bad bout must not drop the card. A naive `$transaction` wrap would either kill that resilience or hit the "aborted-transaction poisoning" documented in `geo/gyms.ts`, and it collides with the additive-table `try/catch` guards. **Correct fix (Wave 1):** a *per-fight* transaction (corners + fight + external-id atomic) that keeps card-level resilience, designed around the additive-table guards. Not a smallest-safe-change; deferred rather than risk regressing live ingest.

### Fix 7b — Drop `--accept-data-loss` (deferred)
`render.yaml:105-116` documents the flag as owner-approved and load-bearing: Prisma false-flags *additive* unique constraints as data-loss and aborts without it, which blocked a real deploy. Yanking it re-breaks that deploy. **Correct fix (Wave 1):** migrate to `prisma migrate deploy` (applies additive uniques cleanly and restores the automatic destructive-change guard), then remove the flag.

---

## Wave 1 — Reliability & Architecture (in progress)

Score movement: **78 → ~82**. Testing/CI (the audit's lowest dimension, 35) is
being lifted first.

| Item | Commit | Verify | Status |
|---|---|---|---|
| Extract pure scoring core + 18 tests | `8f72dca` | TSC·LINT·TEST(67)·BUILD | ✅ done |
| CI gate (typecheck+lint+test+build) | `b937675` | YAML valid; runs verified npm scripts | ✅ done |
| Hot-path indexes | `715e9e9` | prisma validate·BUILD | ✅ done (needs `db push`) |
| `persist.ts` per-fight transaction | `d9cb090` | TSC·LINT·TEST·BUILD | ✅ done |
| Remove dead deps (motion/hls.js/next-themes) | `271a696` | TSC·BUILD | ✅ done |
| Prisma Migrations baseline (local prep) | `b93d6f1` | prisma validate; baseline reflects schema | ✅ prepared — **deploy needs operator** (docs/MIGRATIONS.md) |
| Repo-boundary ESLint rule + migrate 45 call sites | — | — | ⏭ pending (large; incremental) |
| Integration tests (resolve fan-out, auth) | — | — | ⏭ pending (needs test DB) |

### W1-4 — Per-fight persistence transaction · `d9cb090`
**Finding.** `upsertFight` wrote corner fighters + the fight as separate statements → a mid-write failure could orphan corner fighters. (Audit: Database HIGH; Wave-0 deferred.)
**Solution.** Resolve corners (slow dedupe reads) OUTSIDE the tx; wrap create-missing-corners + fight upsert in one `$transaction`; keep additive provenance (external-id/conflicts) OUTSIDE so a missing-table error can't poison the tx. Per-fight `try/catch` resilience preserved; provenance-link behaviour unchanged.
**Validation.** TSC 0, LINT 0, TEST 67/67, BUILD 0.
**Remaining risk.** Interactive-tx wall-clock includes only fast writes now; no behaviour change to graded data. Fan-out still integration-untested (needs test DB).
**Rollback.** Revert the commit.

### W1-5 — Remove dead dependencies · `271a696`
**Finding.** `motion`, `hls.js`, `next-themes` installed, zero imports. (Audit: Code-Quality L1 / Arch H4.)
**Solution.** `npm rm` all three; drop stale `motion` from `optimizePackageImports`. Re-verified zero `src` imports first.
**Validation.** TSC 0, BUILD 0 (58/58).
**Rollback.** `npm i` them back.

### W1-6 — Prisma Migrations baseline (local prep only) · `b93d6f1`
**Finding.** `db push --accept-data-loss` on every prod deploy, no history. (Audit: Database §7 / Code-Quality M1.) Flagged as needing an operator decision.
**Solution (local only, nothing deployed).** Generated `prisma/migrations/0_init` (full current schema, verified to include the Wave 0/1 changes) + lock file; wrote `docs/MIGRATIONS.md` with the exact manual adoption steps (backup → final `db push` → `migrate resolve --applied 0_init` → switch `render.yaml` to `migrate deploy`). `render.yaml` intentionally **unchanged**.
**Validation.** `prisma validate` ✅; baseline confirmed to emit `ON DELETE RESTRICT` + the new indexes. Full apply-and-diff needs a Postgres shadow DB (Docker daemon not running here) — baseline is faithful by construction (`migrate diff` from the schema).
**Remaining risk.** Adoption is a live-DB operation left for the operator; steps + rollback documented.
**Rollback.** Delete `prisma/migrations/` — inert until `migrate deploy` is run.

### W1-1 — Extract & test the pick-scoring core · `8f72dca`
**Finding.** Zero tests on the money path (picks/resolution/scoring). (Audit: Code-Quality H2.)
**Root cause.** The scoring math was inline in `resolve.ts`/`reputation.ts` behind `import "server-only"`, so it could not be imported into a node test.
**Solution.** New pure `src/lib/intelligence/scoring.ts` owns `winnerCorner`, `upsetFactor`, `REP`, `pickReputation`; `resolve.ts` and `reputation.ts` now wrap it (reputation re-exports for API stability). 18 tests cover id-or-slug winner resolution, void bouts, upset scaling, confidence multiplier, streak cap, and clamp bounds.
**Files.** +`scoring.ts`, +`__tests__/scoring.test.ts`, `resolve.ts`, `reputation.ts`.
**Validation.** TEST 67/67, TSC 0, LINT 0, BUILD 0. No behaviour change (pure refactor + tests).
**Remaining risk.** The IO orchestration in `resolveFightPicks` (transaction fan-out) is still integration-untested — needs a test DB (later in Wave 1).
**Rollback.** Revert; re-inline is mechanical.

### W1-2 — CI gate · `b937675`
**Finding.** No CI; Render auto-deploys on push, so a green *local* run was the only gate. (Audit: Code-Quality H1.)
**Solution.** `.github/workflows/ci.yml` runs the existing npm scripts (typecheck, lint, test, build) on push+PR with concurrency cancellation and a dummy-env build.
**Validation.** YAML parses; every step invokes a script already verified green locally.
**Remaining risk.** Cannot execute Actions locally — first real run is on push (operator). Build step relies on graceful DB-less static generation (holds today).
**Operator follow-up.** Enable branch protection on `main` requiring the `verify` check.
**Rollback.** Delete the workflow file.

### W1-3 — Hot-path indexes · `715e9e9`
**Finding.** Full scans on hot paths incl. the WAPU North-Star metric. (Audit: Database.)
**Solution.** Added `@@index` for `FightPick.updatedAt`, `Fight.(result,picksResolvedAt)`, `Fight.createdAt`, `Event.countryCode`, `User.createdAt`, `ForumThread.replyCount`/`reactionCount`.
**Validation.** `prisma validate` ✅; BUILD ✅.
**Remaining risk.** Additive; take effect only on next `prisma db push`. `FighterAlias @@unique` (data-dependent — may fail if dupes exist) and the fighter-name pg_trgm GIN (needs raw SQL) are deferred to the migrations work.
**Rollback.** Revert; re-push.

## Wave 2 — Performance & UX (in progress)

Score movement: **85 → ~88.** Every change measured against the `next build`
route table (baseline captured before any edit).

| Item | Commit | Before → After | Verify |
|---|---|---|---|
| Lazy-load Reels overlay | `a797c18` | `/home` First Load **164 → 143 kB** (−21 kB) | TSC·LINT·BUILD |
| Memoize AuthProvider + seed-ready | `d8b8a6d` | fewer useAuth re-renders; provider ready for server-seed | TSC·LINT·TEST·BUILD |
| Parallelize event-page reads | `b312dc4` | odds+coverage+video: 3-hop waterfall → 1 `Promise.all` | TSC·LINT·BUILD |
| Mount NotificationBell (signed-in) | `e88912e` | dead feature → live; retention loop closed | TSC·LINT·BUILD |

### W2-1 — Lazy-load Reels overlay · `a797c18`
**Objective.** Cut Home first-load JS. **Baseline.** `/home` 164 kB First Load / 15.1 kB route. **Impl.** `dynamic(ssr:false)` + mount only while `open` (overlay renders null when closed anyway). **After.** 143 kB / 7.38 kB — **−21 kB (−13%)**, chunk loads on tap. **Note.** Other audit-named heavies (`PredictionsMarkets`/`ProfileEditor`/`ThreadDiscussion`) are route MAIN CONTENT, not modals — `ssr:false` there adds a flash for no first-load win, so left alone. **Rollback.** Revert.

### W2-2 — AuthProvider memoize + seed-ready · `d8b8a6d`
**Objective.** Stop app-wide re-renders + prepare to kill the auth round-trip/CLS. **Impl.** `useMemo` the context value; add optional `initialUser` (seed → skip mount fetch), backward-compatible fallback when omitted. **Constraint.** Actually wiring the layout to pass `initialUser` reads `cookies()` in the root layout → forces the whole tree dynamic (de-optimizes ~10 static pages incl. `/fighters`, `/rankings/[slug]`). **Flagged as a decision below** — not done unilaterally. **Rollback.** Revert.

### W2-3 — Event-page read parallelization · `b312dc4`
**Objective.** Remove a render-blocking waterfall on the 2nd-largest route. **Impl.** odds/coverage/video were awaited sequentially though independent → one `Promise.all`; hoisted the cache-deduped `getCurrentUser`. Latency = slowest read, not the sum. No behaviour change. **Rollback.** Revert.

### W2-4 — Mount NotificationBell · `e88912e`
**Objective.** Finish a built-but-unmounted feature (Phase 4). **Impl.** Render `<NotificationBell/>` in the header gated on a resolved `user`. Closes the retention loop onboarding's auto-follow feeds. **Rollback.** Remove the two lines.

### Deferred decision — server-seed auth (static→dynamic)
Wiring `initialUser` from the root layout is the real fix for the per-navigation `/api/auth/me` round-trip and profile CLS (Audit H2), but it converts ~10 currently-static pages to dynamic rendering (they read `cookies()` via the layout). On an always-on Render server the cost is modest, but `/fighters`, `/rankings/[slug]`, `/forums/[category]` benefit from static generation for anonymous/SEO traffic. **Recommendation:** accept it (the app is ~90% dynamic already and every page's header is personalized anyway) — but it changes rendering strategy, so confirm before I wire it.

## Outstanding actions for the operator
- **On next deploy:** confirm `prisma db push` applies the `Fight` FK change (Cascade → Restrict, Fix 3) and the new hot-path indexes (W1-3).
- **Enable branch protection** on `main` requiring the CI `verify` check (W1-2).
- **CSP:** review `Content-Security-Policy-Report-Only` reports, add a nonce middleware, then flip to enforced.
- **DECISION NEEDED — Prisma Migrations:** moving off `db push --accept-data-loss` means baselining a migration history against the **live production DB** and changing the Render build command. That is an operational change with rollback implications I will not make autonomously. Confirm you want it and I'll prepare the baseline + `migrate deploy` flow (this also unblocks the `FighterAlias` unique and the fighter-name trigram index).
