# Combat Reviews — Production Release Sign-Off

**Auditor:** Claude Opus 5, acting as release engineer
**Date:** 2026-08-03
**Scope:** Public web launch readiness
**Verdict:** **NO GO** — see §1. This is an *evidence* verdict, not a defect verdict.

---

## 0. What this document can and cannot tell you

This is the most important section. Read it before the scores.

**I have no production access.** The only production evidence that exists is the
Render shell output captured at `2026-08-03T01:06Z`. I cannot re-run it, cannot
query the production database, and cannot observe production behaviour. Every
production claim below is either quoted from that capture (and is now hours old)
or is marked **UNVERIFIED**.

Three evidence classes are used throughout and are never blended:

| Class | Meaning |
|---|---|
| **VERIFIED (local)** | I ran it against the repo or the local database. Command given. |
| **VERIFIED (prod 01:06Z)** | From the operator's Render shell capture. Point-in-time. |
| **UNVERIFIED** | I have no evidence either way. Not a pass. Not a fail. |

An UNVERIFIED item is scored as **not passing**, because in a release gate
"nobody checked" and "it works" are the same risk.

---

## 1. Verdict: NO GO

Not because the software is in poor shape — it is not. The verdict follows from
your own control document, which states: *"no item marked P0 may remain
unresolved at public launch."*

**Two P0 items are confirmed unresolved in production:**

| # | Item | Evidence |
|---|---|---|
| 1 | Legal identity — 7 `LEGAL_*` vars unset | VERIFIED (prod 01:06Z). `/privacy`, `/terms`, `/cookies` publish placeholder text stating they "must not be relied upon". Sign-up **already collects email + password**, so personal data is being collected without a published privacy notice. |
| 2 | Transactional email unset | VERIFIED (prod 01:06Z). Password reset returns 503 by design. No user can recover an account. |

**Thirteen further P0 items in your checklist I have NO evidence for.** These are
organizational, live outside the repository, and I cannot confirm or deny them:

- IP assignments from all five coders
- Removal of former coder access
- Rotation of every production secret
- Independent security review / penetration test
- Backup restore test into a clean environment
- Account/data deletion verified end-to-end in production
- Content and data-source rights register
- Production/development separation confirmed
- Incident response tabletop exercise
- Age policy decision
- Breach-notification decision trees
- Vendor data-processing terms
- Insurance

**If those thirteen are genuinely complete and evidenced, the verdict moves to
GO WITH CONDITIONS once the two confirmed blockers are cleared.** If they are
not, the gap is governance, not code, and no amount of engineering closes it.

---

## 2. Scores

Scored against evidence held. UNVERIFIED depresses a score — that is deliberate.

| Domain | Score | Basis |
|---|--:|---|
| Infrastructure | 85 | DB, R2, evidence storage green (prod 01:06Z). Redis unset — single-instance fallback, acceptable now. |
| Security | 62 | 0 high-risk queries, 0 dependency vulns, headers strong. **CSP is Report-Only.** Rate limiting covers 28/133 routes. No independent pen test. |
| Data integrity | 90 | 100% discipline coverage, records derived, 84% ruleset. Residual is one promotion. |
| Providers | 95 | 9 registered, all writers now accounted for. |
| Cron | 100 | 22/22 scheduled; verified in prod. |
| Rankings | 88 | 9/12 sports. The 3 gaps are absent bout evidence, not code. |
| SEO | 90 | Canonical host set, robots flag-tied, sitemap present. Structured data thin (3 files). |
| Performance | UNVERIFIED | **No load test has been run.** No p95/p99 data. |
| Images | 60 | 15% prod coverage. Accepted as non-blocking per owner. |
| PWA / Mobile | 70 | SW, offline, push, icons, shortcuts done. `TWA_*` unset. |
| Legal | **0** | 7 vars unset. Hard blocker. |
| Monitoring | 75 | Structured logging, cron/provider/launch audits. No alerting evidence. |
| Operations | 80 | Four audit commands, runbook-grade docs. No restore test evidence. |

**Overall: 68/100.** Legal (0) and Performance (unverified) are the two largest
drags, and neither is an engineering defect.

---

## 3. Findings

### F-1 — Content-Security-Policy is Report-Only · **HIGH** · Security

**Problem.** `next.config.ts:77` sets `Content-Security-Policy-Report-Only`. The
policy is well-formed and correctly enumerates `flagcdn.com`, R2, blob and
carto origins — but Report-Only **blocks nothing**. It logs violations.

**Impact.** No CSP protection against XSS in production. Every other XSS control
(output encoding, React escaping) is doing the work alone.

**Evidence.** VERIFIED (local): `grep -n "Content-Security-Policy" next.config.ts`
→ line 77, `Report-Only` only. No enforcing header anywhere.

**Root cause.** Documented and deliberate: `script-src` needs `'unsafe-inline'`
because Next injects inline hydration, and the team chose to observe reports
before enforcing. A nonce middleware is the tracked fix.

**Fix.** Land nonce middleware, then flip to enforced and restore
`upgrade-insecure-requests`.

**Verification.** `curl -I https://<host> | grep -i content-security-policy`
must return the enforcing header. Confirm no console CSP errors on
`/`, `/events`, `/rankings`, `/fighters/[slug]`, `/map`.

**Risk of the fix.** Real — a wrong CSP white-screens the app. Ship behind a
staging soak.

**Owner:** Frontend lead · **Priority:** P1 · **Time:** 2–3 days

---

### F-2 — Rate limiting covers 28 of 133 API routes · **HIGH** · Security

**Problem.** 40 user-facing mutating routes (excluding admin and cron) have no
rate limit.

**Impact.** Spam and cost-amplification vectors: follows, reactions, room posts,
feed signals, avatar upload. Not account-takeover risk — the auth-critical
routes *are* covered.

**Evidence.** VERIFIED (local).
`grep -rln "rate-limit" src/app/api --include=route.ts | wc -l` → **28**.
`find src/app/api -name route.ts | wc -l` → **133**.
Confirmed present on: login, signup, password reset request/confirm, account
delete, username remind, forum threads/posts/report, pick, challenge.
Confirmed absent on: `events/[slug]/follow`, `fighters/[slug]/follow`,
`forums/posts/[id]/react`, `feed/signal`, `fights/[slug]/room`,
`fighters/[slug]/avatar`.

**Root cause.** Applied per-route by import rather than centrally. `src/middleware.ts`
is 15 lines and matches only `/`, so it enforces nothing.

**Fix.** Extend the matcher to `/api/:path*` with a default limit, and keep the
per-route stricter limits as overrides. Central default, local tightening.

**Verification.** Burst test each named route; expect 429.

**Owner:** Backend lead · **Priority:** P1 · **Time:** 1–2 days

---

### F-3 — 76 medium-risk unscoped queries on shared models · **MEDIUM** · Security

**Problem.** `GymClaim`, `GymMember`, `FighterClaim` are read/written without a
statically provable ownership filter.

**Evidence.** VERIFIED (local): `npm run security:audit` →
`HIGH: 0 MEDIUM: 76 LOW: 162 INFO: 706`, detail in `security/query-audit.md`.

**Assessment — and this matters:** the tool reports what it cannot *statically
prove*, not what is broken. **0 high-risk findings** means no private-model
access was found without an ownership filter. These 76 are claim/membership
flows where both parties legitimately have access and the check is in the
caller.

**Fix.** Manual review of the 17 listed claim/membership routes; add explicit
relationship filters where the guard is only in the caller.

**Verification.** Negative-authorization tests: user A cannot read/modify user
B's claim by ID.

**Owner:** Backend lead · **Priority:** P1 · **Time:** 2 days

---

### F-4 — No load test has ever been run · **MEDIUM** · Performance

**Problem.** No evidence of any load or abuse test against fight-night traffic:
signup burst, event page, prediction lock, live discussion, leaderboard recompute.

**Impact.** Capacity is unknown. Fight night is the one moment traffic spikes,
and it is also when prediction locking and settlement run.

**Evidence.** VERIFIED (local): no load-test tooling, config or report in the
repository. One prod signal exists — a `slow-query` warning at 788ms on a Fight
count join during `audit:providers` (prod 01:06Z).

**Fix.** k6 or Artillery against staging at 5× forecast peak.

**Owner:** Platform lead · **Priority:** P1 · **Time:** 2–3 days

---

### F-5 — 2,225 ONE bouts have UNKNOWN ruleset, unresolvable · **LOW** · Data

**Problem.** ONE Championship accounts for the entire residual ruleset gap.

**Evidence.** VERIFIED (local): `npm run backfill:ruleset` →
`2225 events labelled MMA` staying UNKNOWN. Re-ingest of ONE 2024–2026 year
pages persisted 131 events and moved coverage by **zero**.

**Root cause.** Circular and genuinely unresolvable from held data. Those cards
do not name a ruleset in the weight-class cell; 1,742 of the bouts carry no
weight class at all. So `dominantSport` falls back to the configured MMA, and
the backfill then correctly refuses to infer a bout's ruleset from an MMA event —
MMA being both a real ruleset and the generic label every mixed card wears.

**Fix.** Extend the ONE extractor to parse bout tables from onefc.com. Not a
config change: that host 429'd 199 of 224 pages at 800ms.

**Owner:** Data lead · **Priority:** P2 · **Time:** 1 week

---

### Verified NOT findings

Recorded because an auditor should say what they cleared, not only what they flagged.

- **`/api/admin/seed-world/reset` has no admin-session guard** — and is correct.
  It uses a bearer token, returns 404 when unset and 401 on mismatch. Fails
  closed. *(Minor: the comparison is not constant-time. Timing-attack risk on a
  bearer token is negligible here. LOW, optional.)*
- **Dependency vulnerabilities** — `npm audit --production` → **0**.
- **Secrets in the repo** — `.env` and `.env*` gitignored (`.gitignore:7-8`).
- **Accessibility: images without alt** — 0 raw `<img>` without `alt`.
- **Error boundaries** — `error.tsx`, `global-error.tsx`, `not-found.tsx` all present.
- **Debug output** — 4 `console.log` in `src/`. Negligible.
- **Cron coverage** — 22/22 routes scheduled. VERIFIED (prod 01:06Z).

---

## 4. The two blockers, precisely

**B-1 · Legal identity · P0 · 1 day · Owner: founder + counsel**

Set the 7 `LEGAL_*` vars. Until then `/privacy` publishes text saying it must not
be relied upon — which is the one failure mode a legal page must not have: it
looks like a policy, so nobody checks it, and it binds nothing. A privacy notice
must be published **before** personal data is collected. Sign-up already collects
an email.

**B-2 · Transactional email · P0 · 1 day · Owner: platform**

`EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`. `EMAIL_FROM` must be on a
domain verified in Resend. **`onboarding@resend.dev` will not do** — it delivers
only to the Resend account owner, and the reset route returns the same message
either way, so it looks exactly like working password reset while locking out
every real user.

---

## 5. Conditions to reach GO

1. Clear B-1 and B-2. *(2 days)*
2. Produce evidence for the thirteen unverified P0 governance items, or formally
   risk-accept each with owner and expiry. *(Founder + counsel)*
3. Run one load test at 5× forecast fight-night peak. *(F-4)*
4. Re-run `doctor:production` in the Render Shell and attach the output.
5. Commission the independent penetration test your own §0 requires. Nothing in
   this document substitutes for it — I reviewed code, I did not attack a
   running system.

F-1, F-2 and F-3 are P1: they should not gate a soft launch, and they should not
survive to 10,000 users.

---

## 6. Standing audit commands

```bash
npm run doctor:production   # weighted launch score + blockers
npm run audit:launch        # per-sport coverage matrix
npm run audit:providers     # provider health + graph completeness
npm run audit:crons         # every cron route has a schedule
npm run cron:doctor         # did the scheduled jobs actually succeed
npm run security:audit      # AST audit of every Prisma query
```

All read-only. All runnable in the Render Shell.

---

## 7. Sign-off

I can attest, on evidence, to the state of the **codebase and its data**.

I cannot attest to ownership, access control, secret rotation, recoverability,
vendor terms or incident readiness — those live outside the repository and no
artefact in it speaks to them.

**Verdict: NO GO** pending §5.

The engineering is close. The gap is governance evidence and two environment
variables.

*Anyone relying on this document should note §0. A code review is not a
penetration test, and a local audit is not a production audit.*
