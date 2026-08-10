# Google Play release — Combat Reviews

The literal checklist. `docs/MOBILE-RELEASE.md` is the *argument* for the
approach (why a TWA, why not Apple yet); this is the *procedure*, plus the three
readiness states and what separates them.

Run `npm run doctor:production` **in the Render Shell** before and after each
step — a configuration check run on a laptop scores the laptop, not production.
Every `envScoped` check in `src/lib/admin/launch-readiness.ts` says so.

---

## Architecture: Trusted Web Activity, via Bubblewrap

**Decision: TWA. Not Capacitor, not a native shell.**

The repository already satisfies every technical precondition for a TWA — HTTPS,
a valid web manifest with `standalone` display and correct maskable icons, a
service worker with an offline page, and a `/.well-known/assetlinks.json` route.
A TWA is the user's own Chrome rendering the site with no browser UI, so:

- the session cookie is the *same* cookie Chrome already holds — sign-in, sign-out
  and "remember me" work with no second auth system and nothing to keep in step;
- `<input type="file">`, downloads, the back button, and web push are Chrome's
  implementations, not re-implementations;
- a deploy updates the app. Only packaging changes need a new upload.

Capacitor would ship a *second* WebView with its own cookie jar and storage,
which is exactly the "second frontend / second auth" outcome this work is meant
to avoid, and it buys nothing here: no native capability is required.

**What was added to the repo:** a generator (`npm run android:manifest`) that
writes `android/twa-manifest.json` from the live web manifest plus two
environment variables. No Android sources, no second UI, no native code.

```
src/app/manifest.ts ──┐
                      ├─► android/twa-manifest.json ─► bubblewrap ─► app-release.aab
android/version.json ─┘
NEXT_PUBLIC_SITE_URL ─┘
TWA_PACKAGE_NAME ─────┘
```

---

## The production origin: use the Render hostname

**A custom domain is not required.** Verified 2026-08-10 against Google's own
Digital Asset Links API — the service Android consults — for
`https://globalfight-p69k.onrender.com`: the only error was the `404` for the
file that has not been created yet. Google raised **no objection to the host**,
despite `onrender.com` being on the Public Suffix List.

`npm run android:verify` now performs that same API call, so it is re-tested on
every run rather than assumed.

Ship Internal Testing on the Render hostname. Move to a custom domain when you
want to — see `MOBILE-RELEASE.md` for what changes and why it needs a new
`versionCode`.

## The four doctors

They deliberately do not overlap. Run all four.

| Command | Answers | Needs |
|---|---|---|
| `npm run release:doctor` | Is the *release* configured? | nothing |
| `npm run android:doctor` | Can *this machine* build an AAB? | the toolchain |
| `npm run android:verify -- https://host` | Does the *live site* serve what Android fetches? | the deployment |
| `npm run doctor:production` | Is the *platform* ready? | the database |

## Target API 36 — verified, no patching needed

Play requires **API 36 (Android 16)** for new apps *and* updates from
**2026-08-31**. Verified 2026-08-10 by reading the installed template, not by
assumption:

```
@bubblewrap/cli 1.25.0
  template_project/app/build.gradle → compileSdkVersion 36
                                      targetSdkVersion 36
  Android Gradle Plugin 8.9.1 · Gradle 8.11.1
```

**A current Bubblewrap already targets 36.** Do not hand-patch
`android/app/build.gradle` — the value comes from the CLI template and the next
`bubblewrap update` would overwrite the patch. If `npm run android:doctor`
reports a lower template targetSdk, the fix is `npm i -g @bubblewrap/cli`.

`android:doctor` checks the **template** rather than the generated project, so
an outdated CLI is caught *before* a build rather than after one.

## Build the AAB

⚠ **Bubblewrap's first command is INTERACTIVE.** It offers to download a JDK 17
and the Android SDK and blocks on a prompt; in a non-TTY it dies with
`ERR_USE_AFTER_CLOSE: readline was closed`, which names nothing useful. Run it
once at a real terminal. `npm run android:doctor` reports which half is missing
instead of hanging.

```bash
# 0. One-time, AT A REAL TERMINAL — answer the JDK / Android SDK prompts,
#    and ACCEPT THE SDK LICENCES when asked. Refusing them does not fail the
#    command: it logs "Skipping following packages as the license is not
#    accepted: Android SDK Build-Tools 36.1" and carries on, leaving an SDK
#    directory that contains no build-tools and no platforms at all. The build
#    then fails much later for a reason that looks unrelated.
npm i -g @bubblewrap/cli
bubblewrap doctor
npm run android:doctor            # Build-Tools and Platform SDK must both be green

# 1. Version. Every Play upload needs a versionCode Play has not seen.
npm run android:bump              # +1 code, same name
npm run android:bump -- 1.1.0     # +1 code, new name
git commit android/version.json -m "release: android 1.1.0 (code N)"

# 2. Config. Refuses to write anything if either variable is unset or wrong.
NEXT_PUBLIC_SITE_URL=https://globalfight-p69k.onrender.com \
TWA_PACKAGE_NAME=com.combatreviews.app \
npm run android:manifest

# 3. Build.
cd android
bubblewrap init --manifest https://globalfight-p69k.onrender.com/manifest.webmanifest
bubblewrap build
#   → android/app-release-bundle.aab   ← upload this to Play
#   → android/app-release-signed.apk   ← sideload this to test on a device
```

### The keystore is yours, not the repository's

`bubblewrap init` offers to create it, or:

```bash
keytool -genkeypair -v -keystore android/android.keystore -alias android \
  -keyalg RSA -keysize 2048 -validity 10000
```

**This key is the app's identity and it is deliberately not generated by any
script in this repo.** Play will not re-key a published listing: lose it and you
can never update the app; leak it and anyone can sign as you. Choose the
password yourself, store it in a password manager, and keep an offline backup
before you build. `*.keystore`, `*.jks` and the generated Gradle project are
gitignored, and `release:doctor` fails if any key is ever tracked by git.

Read the fingerprint you must publish with:

```bash
keytool -list -v -keystore android/android.keystore -alias android | grep SHA256
```

---

## Versioning

| Field | Where | Rule |
|---|---|---|
| `versionName` | `android/version.json` | `MAJOR.MINOR.PATCH`. Shown to users. |
| `versionCode` | `android/version.json` | Monotonic integer. `npm run android:bump` is the only thing that moves it. |

Not derived from the commit count (rebases move it backwards), not from
`versionName` (1.0.10 and 1.1.0 collide under most encodings), not from a
timestamp (unreviewable). One integer, one commit, one release — so "have I
already shipped code 7?" is answered by `git log`, not by memory.

---

## Digital Asset Links — the step that silently ruins TWAs

If this is wrong the app still opens, **inside a Chrome tab with a URL bar**.
Nothing errors. It just stops looking like an app.

Set on the **deployment** (Render → Environment), not in the repo:

```
TWA_PACKAGE_NAME=com.combatreviews.app
TWA_SHA256_FINGERPRINTS=<upload key SHA-256>,<Play App Signing key SHA-256>
```

**Both fingerprints, comma-separated.** Play re-signs your upload with its own
key, so the fingerprint that verifies in production is *not* the one from your
local keystore. Play Console → Setup → App integrity.

`/.well-known/assetlinks.json` returns **404 while unset, deliberately** — a
malformed statement is worse than a missing one, because Android caches the
failure and the URL bar can persist after you fix it.

Verify, and do not mark this done until it returns your two fingerprints:

```bash
curl https://yourdomain.com/.well-known/assetlinks.json
```

---

## Play Console checklist

### Developer account
- [ ] Google Play Developer account (US$25, one-off)
- [ ] Identity verification complete
- [ ] Organisation vs. individual decided — **an individual account created
      after Nov 2023 must run closed testing with 12+ testers for 14 continuous
      days before it can promote to production.** This is wall-clock time you
      cannot compress. Start it first.
- [ ] Developer name and contact address (these are shown publicly on the listing)

### App identity
- [ ] Application id matches `TWA_PACKAGE_NAME` **and** the deployment env var
- [ ] App name — **Combat Reviews**
- [ ] App icon 512×512 PNG, **no alpha channel** (`public/icons/icon-512.png`
      has alpha — export a flattened copy)
- [ ] Feature graphic 1024×500
- [ ] 2–8 phone screenshots (see *Store listing* below)
- [ ] Category — Sports
- [ ] Content rating questionnaire answered (see *Content rating*)

### Privacy & policy
- [ ] Privacy policy URL resolves: `https://yourdomain.com/privacy`
- [ ] All 7 `LEGAL_*` variables set — **until then those pages publish
      placeholder text saying they must not be relied upon**
- [ ] Data Safety form completed (draft below)
- [ ] Account deletion URL: `https://yourdomain.com/delete-account`
- [ ] UGC moderation, reporting and blocking present (all three ship — see below)
- [ ] Ads declaration: **no ads**
- [ ] Financial features declaration: **none** (see *Gambling* below)

### Technical
- [ ] Custom domain live, `NEXT_PUBLIC_SITE_URL` (full origin) and `APP_HOST`
      (host only) set
- [ ] `/.well-known/assetlinks.json` returns both fingerprints
- [ ] `npm run android:manifest` run against the production origin
- [ ] AAB built and uploaded
- [ ] **targetSdkVersion checked against Play's current requirement at the time
      of upload.** Bubblewrap sets it; Play raises the floor every August and
      rejects on upload. Confirm the number in Play Console rather than from any
      document, including this one.
- [ ] versionCode never reused
- [ ] Deep links verified on a device (an https link to the site opens the app)

### Testing
- [ ] Internal testing track — install from Play, not sideload
- [ ] Closed testing if the account requires it (12 testers × 14 days)
- [ ] Real Android device: back navigation, sign-in persistence, uploads,
      notifications, account deletion, report + block
- [ ] Crash/ANR reporting visible in Play Console vitals

### Operations
- [ ] `ERROR_REPORT_URL` set and an error confirmed arriving at the collector
- [ ] Email provider configured (`EMAIL_PROVIDER` + credentials + `EMAIL_FROM`
      on a **verified** domain) — password reset answers 503 without it
- [ ] `LEGAL_CONTACT_EMAIL` is a mailbox someone reads
- [ ] Database backup verified **and a restore actually tested**
- [ ] `/api/health` monitored externally
- [ ] Rollback documented: Play → previous release, deployment → previous deploy

---

## Data Safety — draft

Derived from `src/lib/privacy-inventory.ts`, which is the source the privacy
notice itself renders from. **Verify each line against the deployment's actual
configuration before submitting** — several rows depend on which optional
features are switched on.

| Play category | Collected | Shared | Required | Purpose | Notes |
|---|---|---|---|---|---|
| Name | Yes | No | Yes | Account | Display name |
| Email address | Yes | No | Yes | Account, password reset | |
| User IDs | Yes | No | Yes | Account | Username |
| Photos | Yes | No | Optional | Account, UGC | Avatar/banner; gym media |
| Other user-generated content | Yes | No | Optional | App functionality | Forum posts, reviews, gym posts |
| Messages (other in-app messages) | Yes | No | Optional | App functionality | DMs. **Not end-to-end encrypted** |
| Approximate location | Yes | No | Optional | App functionality | A pin the user places **themselves**. GPS is never read and the browser location permission is never requested. Off by default. |
| App interactions | Yes | No | Optional | Analytics | First-party, cookieless, no third-party SDK |
| Crash logs / diagnostics | Yes | Yes | — | Diagnostics | Only if `ERROR_REPORT_URL` is set — **confirm before ticking** |
| Government ID / other documents | Yes | No | Optional | Identity verification | Fighter/gym claims only. Private bucket, never public, deleted on approval/rejection/abandonment/account deletion. **Declare this — it is the most sensitive item.** |
| Purchase history | No | — | — | — | No payments anywhere in the app |
| Contacts, calendar, SMS, call logs | No | — | — | — | Never requested |
| Precise location | No | — | — | — | Never requested |
| Advertising ID | No | — | — | — | No ads, no ad SDK, none in `package.json` |

**Security answers:**
- Data encrypted in transit — **Yes** (HSTS with preload; the TWA cannot use cleartext)
- Users can request deletion — **Yes**, `https://yourdomain.com/delete-account`
- Committed to the Play Families policy — N/A unless targeting children (do not)

**Rows that need operator confirmation, not a guess:**
- Crash logs: does `ERROR_REPORT_URL` point at a real collector?
- Email: Resend or SMTP receives the user's address — a processor, declare it
- Voice recordings: the voice-to-profile feature is **disabled**; if it is ever
  enabled, three US processors (Deepgram / OpenAI / xAI) start receiving audio
  and this form becomes wrong

---

## UGC, moderation, reporting and blocking

Play's User Generated Content policy requires four things of an app where users
interact. All four now ship:

| Requirement | Where |
|---|---|
| Users accept terms before creating content | Sign-up records `termsVersion` |
| A stated content policy | `/community-guidelines` |
| Reporting of content **and** users | `ForumReport` + `/api/forums/report`; queue at `/admin/reports` with an `AuditLog` entry per decision, including dismissals |
| **Blocking** of users | `UserBlock` + `/api/users/[username]/block`; button on every profile; list and undo in `/settings` |

Blocking was the gap and is the one substantive code change in this sprint. It
is stored one-directionally and **enforced symmetrically**: once either party
blocks, neither can message or follow the other, the thread leaves both inboxes,
and the blocked author's posts are filtered out of the blocker's reads. The
blocked person is never told — no notification, no profile marker, no counter.

**Automated screening is deliberately narrow and must stay that way.**
`src/lib/moderation/text/` blocks slurs, incitement against a group,
self-harm instruction and spam. **Ordinary swearing is permitted.** Combat-sports
language — "kill him", "finish him", "knock him out", "chink in the armour" — is
covered by explicit false-positive test cases in
`src/lib/moderation/__tests__/text.test.ts`. Do not broaden the rules without
running those.

---

## Gambling — what this app is and is not

**It is not a gambling app, and the Play listing must not present it as one.**

- Predictions score **points**. No money is staked, there is no wallet, no
  payment integration anywhere in the codebase, and no prize.
- Bookmaker **odds** are displayed for information. Every surface that shows
  them carries `OddsDisclosure` — 18+, attribution, "does not accept bets or
  facilitate gambling", and a link to `/responsible-gambling`.
- **Nothing links out to a bookmaker.**

⚠ **The one line that changes the answer.** `src/features/predictions/providers/`
contains Polymarket and Kalshi connectors — real-money venues. Four flags gate
them and **all four fail closed**:

```
MARKET_PRICES_ENABLED   render any market price
POLYMARKET_ENABLED      ingest Polymarket
KALSHI_ENABLED          ingest Kalshi
TRADING_LINKS_ENABLED   emit OUTBOUND links to a trading venue   ← the line
```

Leave `TRADING_LINKS_ENABLED` off for any Play build. Turning it on makes the
app link users to a real-money exchange, which changes what it is under Play's
Real-Money Gambling, Games and Contests policy and requires a separate
declaration plus a country allow-list. Confirm all four are unset in the
production environment before submitting.

---

## Content rating

Answer the questionnaire from these facts. **The rating is Google's output, not
a value to be predicted here.**

- Users can interact and share content: **yes** (forums, DMs, gym posts)
- Users can share their location: **yes**, coarse, self-placed, opt-in, off by default
- References to gambling: **yes** — bookmaker odds are displayed for information
- Simulated gambling: **no** — nothing is staked
- Violence: sports content, real combat-sports results and imagery; no
  gratuitous or interactive violence
- Sexual content, drugs, profanity in first-party content: **no** (user content
  may contain profanity, which is permitted and moderated per the guidelines)

## App access

Play reviewers must be able to reach everything. Core browsing (events,
fighters, gyms, rankings, forums) is public, but predictions, messages, follows
and profile are behind sign-in. **Provide demo credentials in Play Console →
App access**, on an account seeded with at least one prediction and one
conversation, or the reviewer sees empty states and may reject for
non-functionality.

---

## Store listing — draft

**App name:** Combat Reviews

**Short description (≤80):**
> Fights, fighters, gyms and predictions — the combat-sports community in one app.

**Full description (draft — the owner should sign off every claim):**
> Combat Reviews is a combat-sports platform covering MMA, boxing, kickboxing,
> Muay Thai and more.
>
> • Every event — upcoming schedules, full cards, and results as they land
> • Fighter profiles, records and divisional rankings
> • Predictions — call the fights, build a record, climb the leaderboard.
>   Points only. Nothing is staked and nothing is paid out.
> • Gyms — find where people train, read reviews, follow a gym's posts
> • Community — forums, direct messages, and a feed of what the people you
>   follow are doing
>
> Independent. Not affiliated with any promotion or sanctioning body.

**Do not claim:** live streaming, official partnership with any promotion, real
odds guarantees, or a betting capability.

**Screenshots must be captured from the real production app** — nothing in this
repository can generate them and fabricating them would misrepresent the
product. Capture at a phone viewport (9:16), signed in, against real data:

1. `/today` — tonight's card
2. `/events/[slug]` — a full event page
3. `/fights/[slug]` — a matchup with the pick control
4. `/rankings`
5. `/profile` — a record with resolved picks
6. `/gyms/[slug]` — a gym page
7. `/forums` — a live thread

**Feature graphic** (1024×500) must be produced from Combat Reviews branding in
`public/brand/`. It does not exist yet.

---

## Status: what is done and what is not

These are three different states and the difference matters.

### CODE READY — ✅ yes
The repository produces a production Android App Bundle: `npm run android:bump`
→ `npm run android:manifest` → `bubblewrap build`. Every gate passes
(`typecheck`, `lint`, 1768 unit tests, `security:audit` at **0 HIGH**,
production `build`). The Play UGC blocking requirement is implemented.

### PLAY-CONSOLE READY — ❌ not yet
Blocked on things only the operator can do:
a custom domain, `NEXT_PUBLIC_SITE_URL`, the 7 `LEGAL_*` variables, a signing
keystore, the two `TWA_*` fingerprints, the store assets, and the Data Safety
answers that depend on which optional features are switched on.

### PUBLIC-LAUNCH READY — ❌ not yet
Additionally blocked on: working transactional email (password reset answers 503
without it), `ERROR_REPORT_URL`, a **tested** database restore, and — for an
individual developer account — 12 testers × 14 continuous days of closed
testing.

**Aim for internal testing first.** It needs the domain, the legal variables,
the keystore and the assetlinks fingerprints, and nothing else on this page. It
gets the real app onto a real phone from the Play install path, which is the
only way to find the failures that a sideloaded APK hides.
