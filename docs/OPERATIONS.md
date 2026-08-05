# Operations

Everything needed to deploy, verify and recover Combat Reviews.

**Written from the repository.** Anything that cannot be established from the
code is under [Unverified](#unverified--needs-an-operator-to-confirm) rather than
guessed at. Do not treat this document as evidence that those things are done.

---

## Environment variables

`.env.example` is the authoritative list. These are the ones that change
behaviour rather than just enabling a feature.

### Refuses to boot without them (production)

`src/instrumentation.ts` → `assertSafeStartup()` throws, so the process exits
rather than serving in an unsafe configuration.

| Variable | Why the boot fails without it |
|---|---|
| `AUTH_SECRET` | Session cookies would be forgeable. Also rejected for **low entropy** — an all-zeros value fails. 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATABASE_URL` | No database. |
| `EVIDENCE_R2_ENDPOINT` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | Identity documents would fall back to public storage. |

### Observability (optional, but the point of having it)

| Variable | Effect when unset |
|---|---|
| `ERROR_REPORT_URL` | Errors are logged to the console only. `/api/health` reports `errorReporting: "console-only"` — **check this after any deploy.** |
| `ERROR_REPORT_TOKEN` | No `Authorization` header on reports. |
| `APP_COMMIT_SHA` | `/api/health` reports `commit: "unknown"`. Render sets `RENDER_GIT_COMMIT` automatically, so this is only needed elsewhere. |

### Behavioural

| Variable | Effect |
|---|---|
| `REDIS_URL` | Absent → rate limiting falls back to an **in-process** store. Correct on one instance; **counters are per-instance once you scale past one**, so the effective limit multiplies by the instance count. |
| `SCRAPE_CRON_SECRET` / `CRON_SECRET` | The bearer every `/api/cron/*` job authenticates with. |
| `ENABLE_SCRAPER` | `"true"` allows ingestion writes. |
| `LEGAL_CONTACT_EMAIL` | The appeals address in the Community Guidelines. **Unset → the page degrades to "contact us via the Privacy Notice" and appeals have no route.** |
| `SEED_WORLD_ADMIN_TOKEN` | Unset → `/api/admin/seed-world/reset` returns 404. |

---

## Deploying

Render blueprint (`render.yaml`). The web service's `buildCommand` runs
`prisma db push`.

**There is no migration history in the live deploy.** A schema change ships with
its push or it does not ship. A missed push shows as an **empty page, not an
error**, because the queries swallow the failure and render their empty state —
so the site looks dataless rather than broken. This is the single most likely
way to break production quietly.

After every deploy:

```bash
curl -s https://<host>/api/health | jq
```

Confirm:
- `status: "ok"` and `db: "up"`
- `version.short` is the commit you just shipped — **if it is not, the deploy did not land**
- `errorReporting: "configured"` — if it says `console-only`, you are flying blind
- `uptimeSeconds` is small and **grows on the next poll**. A number that keeps resetting is a crash loop that health checks alone will not reveal.

---

## Rolling back

There is **no automated rollback**. The options, in order of preference:

1. **Render → Deploys → Redeploy** a previous successful build. Fastest, and the only one that needs no local machine.
2. `git revert <sha> && git push` — triggers a fresh deploy through CI.

⚠️ **Neither undoes a schema change.** `prisma db push` is applied forward only;
redeploying older code against a newer schema leaves columns the old code does
not know about (usually harmless) or removes ones it needs (not harmless).
Additive changes — a new column, a new enum value — are safe to roll back
through. Destructive ones are not, and need a considered forward fix instead.

---

## Incident checklist

1. **Is it up?** `curl /api/health`. `503` → the database is unreachable. `200` → the process is fine and the fault is narrower.
2. **What is deployed?** `version.short` from the same response. Compare with the intended commit.
3. **Did we just ship?** If the SHA is new, roll back first and diagnose after.
4. **Find the error.** Every server error carries an error id. Users are shown one on the error page — ask for it. Search logs for that id or for `"level":"error"`.
5. **Is it one route or everything?** `/api/health` OK plus one broken page = application bug. Health `503` = infrastructure.
6. **Is it a crash loop?** Poll health twice, thirty seconds apart. Falling `uptimeSeconds` = restarting.

---

## Database

- **Schema:** `prisma db push` on deploy. `prisma/migrations/` exists and is used by CI's integration step; the live deploy does not use it.
- **Seeds:** `npm run seed:demo` (demo community), `npm run seed:e2e` (deterministic test world — safe, scoped entirely to the `e2e-` prefix).
- **Doctors:** `npm run doctor:production`, `npm run audit:integrity`, `npm run cron:doctor`.

---

## CI

`.github/workflows/ci.yml` on every push to `main` and every PR:

typecheck → lint → unit tests → integration tests (real Postgres) →
**security audit (0 HIGH required)** → production build →
**seeded E2E** → **accessibility (axe, WCAG 2.1 A/AA)**

A failure blocks the merge. Render deploys from `main`, so a red build should
never reach a deploy — **but confirm auto-deploy is gated on CI in the Render
dashboard, because the blueprint cannot express that.**

---

## Unverified — needs an operator to confirm

Nothing in this repository proves any of the following. They are listed so they
are not mistaken for done.

- [ ] **Backups.** Whether Render's Postgres backups are enabled, their retention, and **whether a restore has ever been tested.** An untested backup is a hypothesis.
- [ ] **Where data lives.** Region of the database and the object store — determines which transfer rules apply.
- [ ] **Email.** Whether SMTP is configured in production, and deliverability. Password reset and verification **fail closed with a 503** when the mailer is absent — correct behaviour, and it means a misconfiguration locks people out of their accounts rather than failing silently.
- [ ] **`ERROR_REPORT_URL` is set and the collector is receiving.** Send one deliberate error and confirm it arrives.
- [ ] **`LEGAL_CONTACT_EMAIL` is set and monitored.** It is the documented appeals route.
- [ ] **Instance count.** More than one without `REDIS_URL` means rate limits are per-instance.
- [ ] **Alerting.** Whether anything watches `/api/health` and tells a human.
- [ ] **Incident ownership.** Who responds, and how they are reached.
