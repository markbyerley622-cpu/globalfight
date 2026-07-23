# GlobalFight — Prediction Information Architecture

**Date:** 2026-07-24 · **Branch:** `harden/wave0-production-blockers` (not pushed)
RC-4 / Workstream B. Goal: a first-time user understands, in under 5 seconds and
without documentation, that there are **two completely different** prediction
systems. Companion: `RESULT-RESOLUTION.md`, `UX-POLISH.md`.

---

## The two systems (the product model)

| | **Community Prediction** | **Your Challenge** (CombatReviews Challenge) |
|---|---|---|
| Answers | "What does the community think?" | "What do YOU think — and can you beat rivals?" |
| Owns | crowd %, total predictions, pick distribution | your pick, confidence, finish method, streak, points, rivals, leaderboard, history |
| Never shows | confidence, method | — (it owns them) |
| Icon | `Users` (volt) | `Swords` (blood) |
| Framing | social proof | a skill game — "skill, not betting" |

These are different products. The old UI blurred them into one control.

---

## Current IA — the problem (before)

`BoutPick` (on every fight + event page) mixed both systems in one undivided
card, top-to-bottom: **"Make your pick"** (your corner + confidence + method) →
**"The crowd read"** (crowd %). A newcomer couldn't tell that the % bar and their
personal pick were different things, or that confidence/method belonged only to
the personal game. Naming was inconsistent across surfaces: *Prediction Market*,
*Markets*, *Crowd Read*, *Make your pick*, *Battle*, *Predictor Leaderboard*.

## New IA (after)

`BoutPick` is now two explicitly-labelled, ordered sections divided by a rule:

1. **Community Prediction** (first) — `Users` icon, the crowd bar, `N predictions`,
   and a plain-language read: *"12 members predict Tyson Fury (83%) wins."* No
   confidence, no method. Empty state: **"Be the first community prediction."**
2. **Your Challenge** (second) — `Swords` icon, *"Make your call — earn points if
   it lands. Skill, not betting."*, the corner buttons (**"Tap to choose"** →
   **"Your call ✓"**), then confidence + finish method once a corner is chosen.

Card order on a fight, unchanged conceptually and now legible:
**Community Prediction → Your Challenge → the Room (Challenge / Community tabs).**

---

## Naming rules (canonical)

| Concept | Use | Do NOT use |
|---|---|---|
| Crowd consensus | **Community Prediction** | Crowd Read, Prediction Market, Markets, Community Picks |
| Personal scored game | **Your Challenge** / CombatReviews Challenge | Make your pick, Fight Prediction |
| Head-to-head vs a rival | **Challenge** (a rival) | Battle (user-facing) |
| Predictor leaderboard | **Challenge Ranking** | Predictor Leaderboard, Predictions |
| Choosing a corner | **Tap to choose** / **Your call** | Tap to pick / Your pick |

Internal identifiers (`battle`, `BattleRoomDTO`, `FightPick`, DB columns) are
deliberately unchanged — renaming user-facing copy does not require a risky
data/type refactor. The rule is: **the words a user reads are consistent**, the
code names are stable.

## Component / surface map

| Surface | File | Change |
|---|---|---|
| Fight + event pick control | `components/predictions/bout-pick.tsx` | split into Community Prediction + Your Challenge; empty-state copy; corner labels |
| Fight room tabs | `components/fight/fight-room.tsx` | tab `Battle` → `Challenge`; hints → "invite a rival" / "invite sent" |
| Fight module banner label | `components/fight/fight-module.tsx` | "Start a battle" → "Challenge a rival"; "Waiting for a rival" → "Challenge sent · waiting for a rival" |
| Leaderboard | `app/leaderboard/page.tsx` | chip `Predictor Leaderboard` → `Challenge Ranking`; subtitle explains "skill, not betting" |

## User flows

- **Understand the crowd:** land on a fight → the first section IS the community
  bar with its plain-language read. No action needed.
- **Play:** the second section invites your call → choose a corner (Tap to choose)
  → confidence + finish appear → it saves optimistically (`/api/fights/[slug]/pick`).
- **Compete:** correct calls earn points → the **Challenge Ranking** leaderboard →
  head-to-head **Challenge** a rival in the fight room.

## Mobile / desktop
Both sections are single-column and stack identically on mobile and desktop; the
divider + icons carry the distinction at every width. Corner buttons keep ~44px
tap targets; confidence stars keep the ~36px thumb target.

## Accessibility
Section headers are real text with distinct icons; corner buttons carry
`aria-pressed`; confidence stars keep `aria-label="Confidence n of 5"` +
`aria-pressed`; global `:focus-visible` rings apply. No colour-only distinction —
each system is labelled in words.

## Verification
Screenshotted on a seeded fight (12 community predictions, 83/17 split): the two
systems read as visibly separate in well under 5 seconds. TSC 0 · ESLint 0 · unit
95/95 · production build green.

## Future roadmap
- A/B test **"Community Prediction"** vs **"Community Consensus"** (chose the
  former for first-read clarity; parallels "Your Challenge").
- Community pick **distribution over time** (movement/trend) — currently a single
  snapshot bar.
- Rename the `/predictions` markets route (odds, regulatory-gated) so it doesn't
  collide with "Community Prediction" once/if the licensed market re-enables.
- Rival **onboarding** flow polish (invite → accept → settle) surfaced from the
  fight room.
