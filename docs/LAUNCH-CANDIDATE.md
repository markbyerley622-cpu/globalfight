# GlobalFight — Launch Candidate (LC-1) Report

**Date:** 2026-07-23 · **Branch:** `harden/wave0-production-blockers` (33 commits, **not pushed/merged/deployed**) · **Baseline:** `main`
**Basis:** `docs/AUDIT.md` (six-domain audit), `docs/HARDENING.md` (per-fix log), `docs/MIGRATIONS.md`.

---

## 1. Executive Summary

Starting from a 68/100 audited baseline, Waves 0–4 of headless-safe hardening are complete: every Critical/High finding that could be resolved without a browser, a test database, or a deploy has been fixed, verified (`tsc`/`eslint`/`test`/`build` green on every commit), and documented. The codebase is now a credible Launch Candidate at **~93/100**, with the remaining gap consisting almost entirely of **evidence that requires tooling not available in this environment** (integration DB, headless browser/Lighthouse) plus two changes that need deliberate QA (a `sharp` major bump; the repository-boundary migration). No work has been pushed, merged, or deployed.

## 2. Production Readiness Score — **~93 / 100**

Derived from residual risk, not targeted. Dimension deltas vs. the audit:

| Dimension | Audit | Now | Basis |
|---|---|---|---|
| Security | 74 | 90 | XSS closed, headers+CSP(RO), signup RL, SSRF hop-revalidation, report RL, log redaction, **critical Next RCE patched** |
| Architecture | 70 | 84 | Redis fixed, dead deps gone, server-auth seed, dead-code sweep |
| Database | 72 | 86 | cascade→Restrict, per-fight tx, hot-path indexes, migrations baseline |
| API / Backend | 82 | 90 | RL gaps closed, SSRF, health endpoint |
| Performance | 68 | 85 | Reels lazy-load (−21 kB), event waterfall, auth memoize/seed |
| Mobile UX | 74 | 84 | error boundaries, notification bell, loading skeletons, touch targets |
| Accessibility | 76 | 84 | Sheet focus-trap/scroll-lock/aria; **full sweep pending browser QA** |
| Code Quality | 80 | 90 | tests 49→67, dead-code 0, CI gate |
| **Testing / CI** | 35 | 70 | CI gate + money-path unit tests; **integration tests still absent (no test DB)** |
| Ops / Deploy | 55 | 82 | health probe, migrations plan, `--accept-data-loss` exit path documented |

The two dimensions still capping the score — **Testing/CI** and **Accessibility** — are gated on infrastructure this environment lacks (§14).

## 3. Completed Audit Findings

Security H-1 (XSS), H-2 (headers), M-1 (signup RL), M-2 partial; Architecture H1 (Redis), H2 (auth seed), H4 (dead deps), M1 (event waterfall), M4 (memoize), H5 (Reels split); Database HIGH (cascade, persist tx, indexes, dedupe partial); API H1/H2 (signup), M1 (report RL), M3 (SSRF), I1 (redaction); UX H1 (error boundaries), H2 (notification bell), M2 (Sheet a11y), M3 (route), M4 (skeletons), M1 partial (touch targets); Code-Quality H1 (CI), H2 (money-path tests), L1 (dead deps), L3 (stale disables), dead code. Plus a **critical Next.js RCE** surfaced by the dependency audit and patched.

## 4. Remaining Findings

| Finding | Sev | Why not done here |
|---|---|---|
| Integration tests (resolve fan-out, auth routes) | High-value | Needs a throwaway Postgres (Docker daemon not running) |
| Full 44px touch-target + a11y certification | Med | Needs a real browser / Lighthouse |
| `sharp` advisory | High (dep) | Fix is a breaking major bump; needs image-pipeline QA |
| `postcss` advisory (transitive under Next) | Moderate | Clears on a future Next patch; not directly upgradable |
| Repo-boundary: 45 direct-Prisma sites | Med | Large incremental migration; ESLint rule + moves |
| CSP enforced (from Report-Only) | Med | Needs a nonce middleware + report review |
| `FighterAlias` unique + fighter-name trigram | Med | Needs the migrations cutover (data-dependent) |

## 5. Remaining Risk Register

| Risk | Likelihood | Impact | Mitigation / status |
|---|---|---|---|
| Next 15.5 upgrade regression | Low-Med | High | tsc/test/build green; **browser smoke-test required pre-release** |
| Untested resolve/auth logic regresses | Med | High | Unit-tested core; integration tests pending a test DB |
| `sharp` vuln exploited via image | Low | Med | Controlled image pipeline; upgrade + QA planned |
| Multi-instance cache divergence | Low | Med | Redis path fixed; set `REDIS_URL` before scaling >1 |
| Migration cutover data loss | Med | High | Documented runbook + backup step; operator-executed |

## 6. Security Summary

No Critical open. Fixed: stored XSS, missing headers (+ CSP Report-Only), signup DoS/enumeration, image-proxy SSRF (redirect hops), forum-report flooding, log redaction, and a **critical framework RCE** (Next upgrade). Strong pre-existing posture confirmed by audit (admin RBAC, IDOR guards, parameterized SQL, evidence-store hardening). Open: enforce CSP via nonces; `sharp` bump.

## 7. Performance Summary

Measured against the `next build` route table. `/home` First Load **164 → 143 kB** (Reels lazy-load). Event page: 3-hop read waterfall → one `Promise.all`. Auth: per-navigation `/api/auth/me` round-trip **eliminated** (server-seeded) + provider memoized. Hot-path DB indexes added (WAPU metric, resolve cron, country facet). Dead deps removed. LCP/CLS/INP field metrics still need Lighthouse (§14).

## 8. Accessibility Summary

Shared `Sheet` modal now has a focus trap, scroll lock, focus restore, and `aria-labelledby`. Two egregiously-small close buttons enlarged toward 44px. Pre-existing strengths confirmed (engineered contrast, `aria-*`, reduced-motion, gesture-gated permissions). **A full WCAG pass (contrast sampling, keyboard walk, screen-reader, remaining 44px targets) requires a browser and is not certified here.**

## 9. Scalability Summary

Redis cache now actually connects (was silently on a per-process Map — would diverge at >1 instance). Per-fight ingest transaction. Hot-path indexes. Cron overlap protection (`withLease`) exists for the fan-out jobs; remaining unbounded `findMany` caps and worker-concurrency tuning are noted in AUDIT.md §6 for a future pass.

## 10. Operational Readiness

Added `/api/health` (DB-gated readiness). Fail-closed `startup-guard` (AUTH_SECRET, evidence bucket, cron secret) confirmed. Structured logging with secret redaction. Migrations adoption runbook (`docs/MIGRATIONS.md`). **Missing/for-operator:** point Render `healthCheckPath` at `/api/health`; enable CI branch protection; error-reporting/APM (Sentry/Datadog) not wired — recommended pre-launch.

## 11. Test Coverage Summary

67 unit tests pass (was 49): scraper parsers, admin provenance, and the newly-extracted **pick-scoring core** (winner resolution, upset scaling, payout, streak/clamp). **Gap:** no integration tests over the DB-backed paths (resolve fan-out, auth routes, persistence) — blocked on a test Postgres. CI runs typecheck+lint+test+build on push/PR.

## 12. Documentation Status

In sync: `AUDIT.md`, `HARDENING.md` (per-fix log with rollback), `MIGRATIONS.md`, this report, and `.env.example`/`.env.render` (all provider keys documented). Architecture is described inline; no separate ARCHITECTURE.md (optional future).

## 13. Deployment Prerequisites

1. Fill env: evidence R2 bucket (boot-blocker), public R2 (photos), legal identity (public-launch preflight), optional email/push — see `.env.render`.
2. Execute the migrations cutover **or** keep `db push` for now (see `docs/MIGRATIONS.md`); if adopting, do the backup + `migrate resolve` steps.
3. Point `healthCheckPath` → `/api/health`.
4. Set `REDIS_URL` before scaling beyond one instance.

## 14. Manual Verification Checklist (needs tooling absent here)

- [ ] **Browser smoke-test** the Next 15.5 upgrade — key journeys (auth, pick, event page, map, forums).
- [ ] **Lighthouse** on `/home`, `/events`, `/fighters/[slug]`, `/profile` — capture LCP/CLS/INP.
- [ ] **Screen-reader + keyboard** pass on modals, nav, forms; verify remaining 44px targets.
- [ ] **Integration tests** against a disposable Postgres: `resolveFightPicks` fan-out, auth routes, `persist.ts` atomicity.
- [ ] Verify CSP **Report-Only** violations, then move to enforced with nonces.
- [ ] Confirm `prisma db push` applies the pending `Fight` FK (Restrict) + new indexes on first deploy.

## 15. Recommended Release Plan

1. Merge this branch after review → CI green.
2. Staging deploy with real env; run the manual checklist (§14).
3. Fix any smoke-test regressions from the Next bump.
4. Execute migrations cutover in a low-traffic window (or defer, keeping `db push`).
5. Production deploy; watch health + logs.

## 16. Rollback Plan

Every commit is atomic and independently revertible (see `HARDENING.md` per-fix rollback lines). Schema changes take effect only on `db push`/`migrate deploy` — revert the schema + re-push to roll back. The Next upgrade rolls back via `npm i next@15.1.4` + lockfile revert (re-introduces the RCE — only as an emergency). DB: restore the pre-cutover backup.

## 17. Launch Checklist

- [ ] CI green on the branch; branch protection on `main`.
- [ ] Env complete (evidence bucket, R2, legal identity).
- [ ] Manual verification (§14) passed.
- [ ] Health check wired; error-reporting/APM provisioned.
- [ ] Migrations decision made (adopt or defer).
- [ ] `REDIS_URL` set if scaling >1 instance.

## 18. Post-Launch Monitoring Checklist

- `/api/health` alerting (503 → page).
- Error rate / APM traces on auth, pick-resolve cron, ingest.
- DB slow-query log; watch the newly-indexed paths and unbounded `findMany`s.
- Cache hit rate once Redis is live; cron run durations vs. schedule (overlap).
- CSP Report-Only violations trending to zero before enforcing.

## 19. Future Engineering Opportunities (non-blocking)

Repo-boundary ESLint rule + migrate 45 direct-Prisma sites; consolidate the two ingestion stacks (AUDIT §M3); enforce CSP with nonces; `noUncheckedIndexedAccess`; virtualize long lists; OAuth/guest signup; APM/error-reporting; `sharp` upgrade; unbounded-query `take` caps.

## 20. Final Principal Engineer Sign-off

**Conditional GO for staging.** The application is in a defensible Launch Candidate state: no open Critical/High findings that were resolvable headlessly, a working CI gate, tested money-path logic, a patched critical framework RCE, and complete rollback documentation. **It is NOT yet certified for production** — that requires the §14 evidence (browser/Lighthouse/integration-DB), which this environment cannot produce, plus the `sharp` bump. I will not claim ≥95 without that evidence. Recommend: review + merge → staging → run §14 → production.

— *Prepared autonomously; every code change verified `tsc`/`eslint`/`test`/`build`; nothing pushed, merged, or deployed.*
