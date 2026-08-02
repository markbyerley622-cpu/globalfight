# Legal intake — what Combat Reviews needs before it goes public

**Purpose.** Everything below is either (a) a fact only the operator knows, which
the site renders into its legal pages, or (b) a judgement only a qualified lawyer
should make. Nothing here is legal advice; it is a list of the gaps, written by
the engineer who built the pages, so a lawyer is not billing you to discover what
the software already knows about itself.

**How the pages work.** `/privacy`, `/terms`, `/cookies`, `/copyright`,
`/community-guidelines` and `/data-sources` are generated from code, not pasted in.
The privacy notice in particular renders from a data inventory
(`src/lib/privacy-inventory.ts`) traced field-by-field from the database schema, so
it cannot quietly describe a different product than the one running. Filling in
Part 1 makes the pages go live as written. Part 2 is where a lawyer is genuinely
needed.

---

## Part 1 — Seven values only you can supply

These are environment variables set in the Render dashboard. Until they are set,
every legal page publishes placeholder text saying it "must not be relied upon".

| Variable | What it must be | Notes |
|---|---|---|
| `LEGAL_ENTITY_NAME` | The person or company that is the **data controller** | A sole trader's own legal name is valid. "Combat Reviews" alone is not, unless that is a registered entity. If you incorporate later this must change. |
| `LEGAL_ENTITY_ADDRESS` | A real postal address | Required. A data subject must be able to reach the controller off-platform. A registered-office or virtual-office address is acceptable; a PO box may not be in some jurisdictions. |
| `LEGAL_CONTACT_EMAIL` | General legal contact | May be the same mailbox as the two below. |
| `PRIVACY_CONTACT_EMAIL` | Data-protection requests | Separate key so it can be routed later without editing pages. |
| `COPYRIGHT_CONTACT_EMAIL` | Takedown notices | Should be monitored — see Part 2, item 4. |
| `LEGAL_JURISDICTION` | Governing law, e.g. "England and Wales" | Drives the terms and the complaint route in the privacy notice. |
| `POLICY_EFFECTIVE_DATE` | ISO date, e.g. `2026-08-02` | The date the published version takes effect. |

**Deadline reality:** a privacy notice must be published **before** personal data is
collected (UK/EU GDPR Art. 13; Australian Privacy Principle 5). Sign-up already
collects an email address and a password, so this is live now, not a launch task.

---

## Part 2 — Questions for the lawyer

Ordered by how much they change what we build.

### 1. Who is the controller, and where are the users?

The site is reachable worldwide and has no geo-gate. That likely brings UK/EU GDPR
into scope regardless of where you sit. **If the controller is established outside
the UK/EU but has users inside it, an Article 27 representative may be required** —
a real cost and a named person, so it needs deciding before launch rather than
after.

**Question:** which regimes apply, and do we need a representative or a registered
DPO? (We do not believe a DPO is required — no large-scale special-category
processing — but the ID-document flow in item 3 is the item that could change that.)

### 2. User-generated content and platform liability

The site hosts forum posts, comments, predictions and **private direct messages**
between users.

**Questions:**
- Does the operator qualify for hosting-provider protection (e-Commerce Directive
  Art. 14 / UK equivalent / CDA §230 if US-facing), and what notice-and-takedown
  process must exist to keep it?
- **Online Safety Act (UK):** does this service fall in scope, and if so which
  duties bite at this user count? It carries user-to-user messaging and a
  self-declared minimum age, which is the combination that usually triggers it.
- Is the current age declaration (a tick, not a date of birth or verification)
  sufficient, or is age assurance required?

### 3. Identity documents — the highest-risk processing

To claim a fighter profile, a user uploads a passport, driving licence, ID card or
federation licence. Technically these are held in a private bucket, never public,
access-logged, and deleted on a schedule (immediately on approval; 14 days after a
rejection; 30 days if abandoned).

**Questions:**
- Is **consent** the right lawful basis, or is legitimate interests more honest
  given the user cannot get the feature without uploading?
- Do these count as identity data requiring a **DPIA** (Data Protection Impact
  Assessment)? Our reading is that a DPIA is likely required and does not yet exist.
- Are the retention windows defensible?

### 4. Sports data, names and likenesses

Fighter records, cards and results are compiled from **public sources**
(Wikipedia and similar, under their licences) — see `/data-sources`, which lists
each source and its licence. Fighter names and biographical facts are published
without individual consent, on the basis that professional competition results are
public record.

**Questions:**
- Is that basis sound for **image rights / personality rights**, which vary sharply
  by jurisdiction?
- Fighter **photographs** are the sharper question. Some are licensed (Wikimedia
  Commons, with attribution rendered); others are absent. What is the standard for
  adding more?
- Does a **DMCA agent registration** (or local equivalent) need filing, given
  `/copyright` invites takedown notices?

### 5. Predictions — confirming this is not gambling

No money is staked, deposited or won. Predictions score points only. Odds from a
third-party API are displayed next to bouts **for information**.

**Question:** does displaying bookmaker odds — while operating a free prediction
game with leaderboards — create any licensing or advertising exposure in the
target markets? We believe not, but it is the kind of thing a regulator looks at,
and it is cheap to confirm now and expensive to unwind later.

### 6. Two published statements that are currently untrue

Flagged because they are promises the software does not keep, and a promise you
cannot keep is worse than no promise:

- **`/community-guidelines`** states every report is reviewed by a person. There is
  no moderation team. Either staff it or change the wording.
- **`/data-sources`** states that BKFC and ONE Championship licences are required
  before production use. Both are currently being ingested from public sources.
  Either obtain the licences, stop ingesting, or correct the statement.

### 7. Terms of Service

`/terms` is generated and covers: no money/no gambling, users retain ownership of
what they write, data may be wrong and must not be relied on, conduct rules, and
minimum age.

**Question:** please review and supply corrected wording for limitation of
liability, indemnity, governing law and dispute resolution, and account
termination — the clauses where generated text is least likely to be adequate.

---

## Part 3 — What is already done

So nobody pays to re-check it:

- Passwords hashed with bcrypt; reset tokens stored only as SHA-256 hashes,
  single-use, 30-minute expiry.
- Sessions are signed, `httpOnly`, `SameSite=Lax`, `Secure` in production, with a
  session-epoch counter so sign-out-everywhere works.
- **No third-party analytics, advertising or tracking script.** Usage analytics are
  first-party and cookieless. Only two cookies are set: the session and a language
  preference — both strictly-necessary or preference class, so no consent banner is
  required under PECR.
- Account deletion is immediate and permanent, including uploaded documents.
- Location is a pin the user places themselves, hidden by default. **Device GPS is
  never read** and the browser location permission is never requested.
- Every third party that receives personal data — including ones that only receive
  an IP address, such as the map-tile and country-flag CDNs — is named in the
  privacy notice, with what it receives and why.
- Consent at sign-up is recorded with a timestamp and a policy version, so it can
  be demonstrated later (GDPR Art. 7(1)).
- An automated test asserts every personal-data table in the database is described
  in the privacy notice, so the notice cannot silently fall out of date.

---

## Part 4 — Non-legal blockers, for scheduling

Not for the lawyer; listed so the launch date is realistic.

1. **Custom domain.** Needed for trustworthy branding, for sending email at all
   (see 2), and for any future Play Store build.
2. **Transactional email sender.** Password reset returns a 503 until a verified
   sending domain is configured. A free-mail address (Outlook/Gmail) cannot be used
   — their DMARC policy rejects it.
3. **Object storage.** Uploaded avatars currently land on the container's ephemeral
   disk and disappear on redeploy.
4. **Accessibility and performance audits** have not been run.
