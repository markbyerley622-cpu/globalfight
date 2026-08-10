# Shipping Combat Reviews to Google Play and the App Store

> **This page is the ARGUMENT** — why a TWA, why not Apple yet, what the
> blockers are and why. The **procedure** (build commands, versioning, the
> Play Console checklist, the Data Safety draft, the policy audit) lives in
> [`GOOGLE_PLAY_RELEASE.md`](./GOOGLE_PLAY_RELEASE.md). Follow that one when
> you are actually shipping; read this one to understand it.

Run `npm run doctor:production` in the Render Shell first. Every item below that
can be checked automatically is checked there, under the **Mobile** group.

---

## The short version

**Google Play is a two-week path and is worth doing now.** The app is a Next.js
PWA with a service worker, an offline page, push, and correct maskable icons —
which is the whole technical requirement for a Trusted Web Activity. What is
missing is configuration and store assets, not engineering.

**Apple is not worth starting yet**, and the reason is specific rather than
general — see the last section.

---

## Google Play — Trusted Web Activity

A TWA is your site rendered by the user's Chrome, in a shell with no browser UI.
It is a real Play listing. It updates when you deploy, not when Google approves.

### 1. A custom domain — NOT a prerequisite. Corrected 2026-08-10.

**This section previously said a custom domain had to come first and that
`globalfight-p69k.onrender.com` "will not do". That was asserted, never tested,
and it is wrong.** It was the single biggest thing standing between this project
and an installable build, so the correction matters more than the claim did.

Tested against **Google's own Digital Asset Links verifier** — the service
Android actually consults:

```
GET https://digitalassetlinks.googleapis.com/v1/statements:list
      ?source.web.site=https://globalfight-p69k.onrender.com
      &relation=delegate_permission/common.handle_all_urls
```

The only error returned was `ERROR_CODE_FETCH_ERROR — 404 Not Found` for the
missing `assetlinks.json`. **No objection to the host.** Google resolved it,
fetched it, and would have accepted a statement had one been there.

This holds despite `onrender.com` being on the
[Public Suffix List](https://publicsuffix.org/list/) (verified: line 15392,
submitted by Render). That listing works *in your favour* — it makes
`globalfight-p69k.onrender.com` a registrable domain in its own right, a real
site boundary for cookies, and a valid Digital Asset Links origin. Digital Asset
Links is scoped per-origin, not per-registrable-domain.

`npm run android:verify` now runs that same API call on every check, so this is
re-tested rather than re-assumed.

**So: you can ship to Play Internal Testing on the Render hostname today.**

The custom domain is still worth doing, for reasons that are real but are not
blockers:

- The Render hostname changes if the service is ever recreated — and the host is
  baked into the published Android app, so a change means a new AAB release.
- `globalfight-p69k.onrender.com` in a store listing reads like a staging URL.
- It is your address, not Render's.

When you do move, change **both** and nothing else:

1. Point the domain at Render (Settings → Custom Domain).
2. `NEXT_PUBLIC_SITE_URL=https://yourdomain.com` — **full origin, scheme included**.
3. `APP_HOST=yourdomain.com` — **host only, no scheme**. What the cron jobs curl.

Then re-run `npm run android:manifest` and ship a new `versionCode`: the old app
points at the old host.

> Also corrected: this document claimed the site was unindexed because
> `NEXT_PUBLIC_SITE_URL` was unset. It **is** set in production —
> `robots.txt` serves `Allow: /` with `Host: https://globalfight-p69k.onrender.com`
> and pages carry `robots: index, follow`.

### 2. Digital Asset Links — the step that silently ruins TWAs

If this is wrong, the app still opens — inside a Chrome tab **with a URL bar**.
Nothing errors. It just stops looking like an app.

`/.well-known/assetlinks.json` is already implemented as a route. Set:

```
TWA_PACKAGE_NAME=com.combatreviews.app
TWA_SHA256_FINGERPRINTS=<upload key SHA-256>,<Play App Signing key SHA-256>
```

**Both fingerprints, comma-separated.** Play App Signing re-signs your upload
with Google's own key, so the fingerprint that works in production is *not* the
one from your local keystore. Listing both is what makes internal-testing builds
and production builds verify. Find the Play key under
**Play Console → Setup → App integrity**.

Verify before submitting:

```bash
curl https://yourdomain.com/.well-known/assetlinks.json
```

It returns 404 while unset — deliberately. A malformed assetlinks is worse than
a missing one, because Android caches the failure and the URL bar can persist
after you fix it.

### 3. Build the APK/AAB

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://yourdomain.com/manifest.webmanifest
bubblewrap build
```

Bubblewrap reads the manifest you already have. Answer its prompts with the
package name you put in `TWA_PACKAGE_NAME` — they must match exactly.

### 4. Store assets — the only real manual work

Nothing in the codebase can generate these.

| Asset | Spec | Notes |
|---|---|---|
| App icon | 512×512 PNG, no alpha | `public/icons/icon-512.png` has alpha; export a flattened copy |
| Feature graphic | 1024×500 PNG/JPG | Shown at the top of the listing |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | Use `/today`, `/events/[slug]`, `/rankings`, `/profile` |
| Tablet screenshots | optional | Improves ranking on tablets |
| Short description | ≤80 chars | |
| Full description | ≤4000 chars | |
| Privacy policy URL | must resolve | `https://yourdomain.com/privacy` — **see the blocker below** |

### 5. Data safety form

Play requires an accurate declaration. This app collects: email, password hash,
display name, optional avatar/banner, predictions, follows, forum posts, and —
for fighter claims — **identity documents**. Declare that last one; it is
sensitive and the retention sweep (`gf-cron-retention`) is what backs the
retention claim you will make.

`src/lib/privacy-inventory.ts` already enumerates what is collected. Use it as
the source for the form rather than writing the list again from memory.

### 6. Closed testing

Play requires 12 testers for 14 continuous days before a personal developer
account can go to production. Start this **before** the assets are finished —
it is a wall-clock delay you cannot compress.

---

## Blockers you must clear first

These are not mobile-specific, but they will sink a Play review or an early user.

1. **Legal identity** — all 7 `LEGAL_*` variables are unset, so `/privacy`,
   `/terms` and `/cookies` publish placeholder text saying they "must not be
   relied upon". Play requires a working privacy policy URL, and a privacy notice
   must be published *before* personal data is collected. Sign-up already
   collects an email.

2. **Transactional email** — `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`.
   Password reset currently answers 503 by design. An app store user who cannot
   reset a password leaves a 1-star review.

   `EMAIL_FROM` must be on a domain you have **verified in Resend**.
   `onboarding@resend.dev` is the sandbox sender — it only delivers to the Resend
   account owner, and the reset route returns the same message either way, so it
   looks exactly like working password reset while locking out every real user.

---

## Apple — wait, and here is the specific reason

App Store Review Guideline **4.2 (Minimum Functionality)** rejects apps that are
repackaged websites. A TWA-equivalent iOS wrapper is precisely that shape, and
Apple rejects them routinely.

The fix is not a better wrapper — it is having something that could only exist as
an app. This codebase is already close on two of them:

- **Push notifications** — implemented (`src/lib/push/send.ts`), needs VAPID keys.
  iOS 16.4+ supports web push for home-screen PWAs, which does *not* require an
  App Store listing at all.
- **Share sheet** — share cards already exist; native share targets do not.
- **Camera upload** — the avatar pipeline exists; a native capture flow does not.

**Recommended order:**

1. Ship the PWA. iOS users can already "Add to Home Screen" and get standalone
   mode, offline, and push. That is most of the value with none of the review.
2. Ship Google Play via TWA.
3. Revisit Apple only once one of the above is genuinely native.

Submitting to Apple now most likely costs you $99 and a 4.2 rejection.

---

## Order of work

1. Custom domain + `NEXT_PUBLIC_SITE_URL` + `APP_HOST`
2. `LEGAL_*` (7 vars) — unblocks the privacy policy URL
3. Email (3 vars) — unblocks password reset
4. `VAPID_*` — turns push on
5. `TWA_*` — turns assetlinks on
6. Bubblewrap build → internal testing → 12 testers × 14 days
7. Store assets while the test window runs
8. Production release

Re-run `npm run doctor:production` after each step. Steps 1–5 are the ones it
scores.
