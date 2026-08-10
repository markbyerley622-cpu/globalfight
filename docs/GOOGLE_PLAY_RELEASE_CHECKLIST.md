# Google Play release checklist — Combat Reviews

Three categories, because they fail for three different reasons and are fixed by
three different people. Do not merge them.

- **ENGINEERING** — provable inside this repository. A command answers it.
- **OPERATOR** — only the account holder can do it. No command can prove it.
- **GOOGLE PLAY** — only Play Console can confirm it.

Companion documents: [`GOOGLE_PLAY_RELEASE.md`](./GOOGLE_PLAY_RELEASE.md) (the
procedure and the Data Safety draft) and [`MOBILE-RELEASE.md`](./MOBILE-RELEASE.md)
(why a TWA, why not Apple yet).

## The three commands

| Command | Answers | Needs |
|---|---|---|
| `npm run release:doctor` | Is the *release* configured? Origin, package id, fingerprint shape, version, legal vars, real-money flags, scanner pairing, committed secrets. | nothing (no database) |
| `npm run android:verify -- https://host` | Does the *live site* serve what Android will fetch? assetlinks, manifest, HSTS, robots, `/privacy`, `/delete-account`. | the deployment |
| `npm run doctor:production` | Is the *platform* ready? Data, crons, providers, storage. | the database |

Run all three. They deliberately do not overlap.

---

## ENGINEERING — must be green

Every line here is checkable. Nothing on this list is a judgement call.

### Gates
- [ ] `npm run typecheck`
- [ ] `npm run lint` — 0 errors
- [ ] `npm test` — full unit suite
- [ ] `npm run test:integration` — **needs a `_test` database**; `resetDb` refuses any other name
- [ ] `npm run security:audit` — **0 HIGH**, and MEDIUM findings reviewed rather than suppressed
- [ ] `npm run build` — production build
- [ ] CI green on `main`, including the cross-browser + mobile Playwright step

### Product controls Play requires
- [ ] Terms accepted before content creation (`termsVersion` recorded at signup)
- [ ] Reporting reaches `/admin/reports` and can be actioned
- [ ] Every moderator decision writes an `AuditLog` row, dismissals included
- [ ] Blocking works from a profile and is undoable in `/settings`
- [ ] Blocking actually stops messaging, following and content visibility **in both directions**
- [ ] In-app account deletion works and re-authenticates
- [ ] `/delete-account` resolves **without signing in**
- [ ] Media uploads fail closed when no scanner is configured — never opened to make an upload work

### Android package
- [ ] `npm run android:bump` and the new `versionCode` is committed
- [ ] `npm run android:manifest` run against the **production** origin
- [ ] `bubblewrap build` produces `app-release-bundle.aab`
- [ ] `npm run release:doctor` — 0 blockers
- [ ] `npm run android:verify` — 0 failures against production
- [ ] `targetSdkVersion ≥ 36` in `android/app/build.gradle` *(see the dated requirement below)*
- [ ] No keystore, `.env`, or key tracked by git

---

## OPERATOR — must be verified manually

No command can prove any of these. Do not tick one because it "should be" true.

### Domain and configuration
- [ ] Custom domain live on Render, certificate issued
- [ ] `NEXT_PUBLIC_SITE_URL` = full origin, `https://` included
- [ ] `APP_HOST` = host only, no scheme, **same host**
- [ ] All 7 `LEGAL_*` set — verify by loading `/privacy` and confirming it does **not** say "must not be relied upon"

### Email and contact
- [ ] `EMAIL_PROVIDER` + credentials + `EMAIL_FROM` on a **verified** domain
- [ ] Password reset tested end to end **to an address you do not own** — Resend's `@resend.dev` sender delivers only to the account owner and the route answers identically either way
- [ ] `LEGAL_CONTACT_EMAIL` is a mailbox a human reads
- [ ] Every legal page exposes a working contact route

### Signing
- [ ] Upload keystore generated **outside the repository**
- [ ] Keystore + password stored in a password manager **and** an offline backup
- [ ] Play App Signing enrolled
- [ ] Upload key SHA-256 recorded
- [ ] Play App Signing key SHA-256 recorded (Play Console → Setup → App integrity)
- [ ] `TWA_SHA256_FINGERPRINTS` contains **both**, comma-separated
- [ ] `curl https://yourdomain.com/.well-known/assetlinks.json` returns both

> A lost keystore means you can never update the app. A leaked one means anyone
> can sign as you. Play will not re-key a published listing.

### Operations
- [ ] `ERROR_REPORT_URL` set — `/api/health` must stop reporting `"errorReporting":"console-only"`
- [ ] A deliberate test error observed arriving at the collector
- [ ] Database backups on, with a known frequency and retention
- [ ] **A restore actually performed into a scratch database.** An untested backup is not a backup
- [ ] `/api/health` monitored externally with alerting
- [ ] Web service instance type confirmed not to spin down *(see Risks in the release report — production answered 502 on first contact and came up reporting 49s uptime)*
- [ ] Rollback rehearsed: Play → previous release, Render → previous deploy

### Reviewer access
- [ ] A dedicated reviewer account exists on production
- [ ] It has at least one prediction, one conversation and one followed entity, so the reviewer sees content and not empty states
- [ ] No 2FA, no manual approval, no hidden setup step
- [ ] Credentials entered in **Play Console → App access** — never in this repository

---

## GOOGLE PLAY — must be confirmed in Play Console

### Account
- [ ] Developer account created and paid
- [ ] **Developer identity verification complete** — required before you can submit
- [ ] Organisation vs. individual decided

### App content declarations
- [ ] Data Safety form submitted (draft in `GOOGLE_PLAY_RELEASE.md`)
- [ ] Account deletion URL accepted: `https://yourdomain.com/delete-account`
- [ ] Privacy policy URL accepted: `https://yourdomain.com/privacy`
- [ ] Content rating questionnaire completed
- [ ] Ads declaration: **no ads**
- [ ] Target audience: **not** children — do not opt into the Families programme
- [ ] Government-ID collection declared (fighter/gym claims)

### Release
- [ ] App created with the final application id — **permanent**
- [ ] AAB uploaded and accepted
- [ ] Target API level accepted
- [ ] Store listing complete: name, short + full description, icon (512×512, **no alpha**), feature graphic (1024×500), 2–8 phone screenshots
- [ ] Internal testing track live and installed **from Play**, not sideloaded
- [ ] Closed testing satisfied **if your account requires it** (see below)
- [ ] Production submission

---

## Dated Play requirements — verified 2026-08-10

Verified against Google's own documentation on the date shown. **Re-check before
you submit** — these change, and a stale number in a document is exactly how a
release gets rejected at the last step.

| Requirement | Value | Applies to |
|---|---|---|
| Target API level | **API 36 (Android 16)** from **31 Aug 2026** for new apps *and* updates. Extension to 1 Nov 2026 can be requested. | Every upload after that date |
| Existing-app floor | API 35 to stay available to new users on newer devices | Already-published apps |
| Closed testing | **12 testers, opted in for 14 continuous days**, before production access | **New personal developer accounts only.** Organisation accounts are not subject to it |
| Developer verification | Required before submitting. Auto-registration for existing Play apps began March 2026 | All developers |
| Account deletion | Must be possible **in the app _and_ via a web resource**, and must delete data rather than freeze the account | Any app allowing account creation |
| UGC | Terms acceptance before creating UGC; moderation; **in-app reporting of content and users**; **in-app blocking of users** wherever users interact directly | This app (forums, DMs, gym posts) |

> ⚠ **21 days.** Today is 2026-08-10 and the API 36 requirement lands on
> 2026-08-31. Bubblewrap's target SDK comes from the CLI's template, so update
> the CLI (`npm i -g @bubblewrap/cli`) before generating the project and let
> `npm run release:doctor` confirm the number in `android/app/build.gradle`.
> If the first upload slips past the 31st with a lower target, Play rejects it.

Sources: [target API level](https://support.google.com/googleplay/android-developer/answer/11926878),
[testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465),
[account deletion](https://support.google.com/googleplay/android-developer/answer/13327111),
[UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937),
[developer verification](https://developer.android.com/developer-verification).

---

## What must never be done to make a check pass

- Never enable `TRADING_LINKS_ENABLED` — it links users to a real-money venue
- Never set `UGC_MEDIA_UPLOADS_ENABLED=true` without a scanner
- Never change the password-reset 503 into "check your inbox" when no mail was sent
- Never commit a keystore, a key, or a `.env`
- Never widen `src/lib/moderation/text/` to catch ordinary combat-sports language — "kill him", "finish him", "chink in the armour" are deliberate false-positive test cases
- Never delete a failing cross-browser test to restore a green tick
