# Design-system audit — execution polish pass

**Date:** 2026-08-05 (two passes) · **Scope:** the UI token layer and component primitives
(`src/app/globals.css`, `src/components/ui/*`, 286 `.tsx` files).

The benchmark is the class of product this app is trying to sit next to — Linear,
Stripe, Vercel, Raycast. What those share is not a component library; it is that
a *small* number of decisions are made once and then held everywhere. This audit
measures where GlobalFight holds its decisions and where it re-makes them.

The headline: the token layer here is genuinely good — a fluid space scale, a
named easing library, a reduced-motion backstop, a documented `.tap` primitive,
`fog` already corrected to clear AA. The failure is not taste, it is **reach**.
Several tokens exist and are ignored, and the one layer with no token at all
(type below 12px) fragmented into 22 near-identical values.

---

## Executed

### 1. Micro-type: 22 arbitrary sizes → a 6-step ramp

**Measured before:** 554 `text-[…rem]` call sites across 137 files, 22 distinct
values, **eleven of them inside the 8.8px–11.5px band**:

```
118 × 0.7rem    83 × 0.65rem   76 × 0.72rem   73 × 0.68rem   69 × 0.6rem
 26 × 0.62rem   26 × 0.66rem   16 × 0.58rem   … 14 more
```

`0.65 / 0.66 / 0.68 / 0.70 / 0.72rem` are not five decisions. They are one
decision made five times, and the sub-pixel drift between them is exactly why
adjacent components read as coming from different products.

**Root cause:** Tailwind's ramp stops at `text-xs` (12px), and this app's entire
meta layer — badges, chips, counts, eyebrows, table cells, stat captions — lives
*below* that. With nothing to reach for, 137 files reached for an arbitrary value.

**Fix:** three tokens close the gap under `xs`, giving one ramp:

| token | rem | px | absorbed | sites |
|---|---|---|---|---|
| `text-4xs` | 0.5625 | 9 | 0.5, 0.55, 0.56, 0.58 | 27 |
| `text-3xs` | 0.625 | 10 | 0.6, 0.62, 0.64, 0.65 | 184 |
| `text-2xs` | 0.6875 | 11 | 0.66, 0.68, 0.70, 0.72 | 293 |
| `text-xs` | 0.75 | 12 | 0.74–0.80 | — |
| `text-sm` | 0.875 | 14 | 0.82, 0.86, 0.90 | — |
| `text-base` | 1 | 16 | 0.95, 0.98, 1.05 | — |

Assignment is round-to-nearest, with **one deliberate exception**: `0.72rem`
(11.52px) is 0.04px nearer 12 than 11, but it is the same semantic role as
0.68/0.70 — chip/badge/meta label. Shipping chips one step larger than badges is
the inconsistency being removed, so it snaps down to 11.

**Two sites intentionally left arbitrary:** `text-[1.75rem]` (`recent-events`)
and `text-[2rem]` (`victory-card`) are single-site display headings with no
adjacency problem to solve. Rounding them onto the ramp changes a deliberate size
for zero coherence gain.

#### The load-bearing detail

The new tokens define font-size **only** — no `--text-*--line-height`
companions. A bare `text-[0.7rem]` sets font-size and *inherits* line-height;
had the paired token been defined, these utilities would also have set
line-height and silently re-flowed 554 sites. Verified in the compiled output:

```css
.text-2xs{font-size:var(--text-2xs)}   /* no line-height — layout-neutral */
```

Also verified: `tailwind-merge` (v2, unconfigured) classifies `text-2xs/3xs/4xs`
as **font-size** via its t-shirt-size validator, so `cn()` collapses
`text-2xs text-xs` correctly and never confuses them with `text-color`. Without
that check, `cn("text-2xs", "text-white")` could have dropped one of the two.

### 2. `.cr-touch-target` — a dead primitive that also didn't work

`.cr-touch-target` was defined in `globals.css` with **zero call sites**, while
**18 interactive controls rendered below the 44px thumb floor** (four at 24px).

It shipped as `min-height/min-width: 44px` under a comment promising *"without
forcing a visual size change"* — but `min-*` beats `width`, so it did the exact
opposite: applied to a `size-6` close button it would have inflated a 24px
control into a 44px bordered box. That contradiction is the most likely reason
nobody ever used it.

Rewritten to keep its own promise — a centred pseudo-element expands the **hit
area** and leaves the box alone:

```css
.cr-touch-target { position: relative }
.cr-touch-target::after {
  content:""; position:absolute; top:50%; left:50%; translate:-50% -50%;
  width:100%; height:100%; min-width:44px; min-height:44px;
}
```

Applied to **13 controls**; 18 → 6 under the floor.

#### Where it is deliberately NOT applied

The 44px zone can overhang siblings, and in an overlap **the control later in the
DOM wins**. The six remaining controls are all destructive, or adjacent to one:

| control | box | why excluded |
|---|---|---|
| `gym-reviews` edit + delete | 26px | 4px gap → zones overlap by 14px; "edit" taps would route to **delete** |
| `thread-discussion` edit + delete | 26px | same pairing |
| `thread-card` delete | 28px | sits *on top of* the card's own tap surface; a 44px zone would delete threads people meant to open |
| `image-upload` replace + remove | 28px | adjacent pair on a thumbnail overlay |
| `gym-gallery-manager` drag + delete | 24px | pair clipped by a small photo tile |

For the two action rows with room, the safe half of the fix was applied instead:
real box 26 → 30px (`p-1.5` → `p-2`) and gap 4 → 8px (`gap-1` → `gap-2`). No
overlap is introduced.

Note these all still clear **WCAG 2.5.8 AA (24×24)**; 44px is the AAA / Apple HIG
target, which is the right bar for a mobile-first product but not a violation.

### 3. Half-tokenised podium + gradients

The P4P podium wrote rank 1 with `gold-500`/`gold-400` tokens and ranks 2 and 3
with raw `#cfd4dc`/`#cd7f32` — one component, half tokenised. Added `--color-silver`
and `--color-bronze` (single-step, like `chalk`/`mist`/`fog`).

Nine gradient stops of `#141923`/`#0a0d12` — which *are* `ink-800`/`ink-900` — now
reference `var(--color-ink-*)` inside their Tailwind arbitrary values.

**Left as raw hex, correctly:** `lib/og.tsx` (satori cannot resolve CSS
variables), `global-error.tsx` (must render with no stylesheet), and
`var(--accent, #e11d2a)` fallbacks. Also `today/page.tsx`'s `accent="#e11d2a"`
props — that pipeline builds alpha by string concatenation (`` `${accent}66` ``),
which a `var()` cannot support. That constraint is worth knowing before anyone
"tidies" it.

---

## Executed — second pass (A–D, previously deferred)

The four findings below were recorded as deferred because a blind codemod would
break the places where someone had already got it right. They were executed by
classifying every call site and reviewing the report, not by find-and-replace.

### A. Radius sprawl — 7 tiers, ~774 sites → one ladder

The ladder is now documented in `globals.css` beside the tokens:

| tier | px | role | sites |
|---|---|---|---|
| `sm` | 4 | inner item of a padded track | 4 |
| `md` | 6 | controls inside controls | 54 |
| `lg` | 8 | buttons, inputs, icon tiles, rows, menu items | 366 |
| `card` | 14 | content cards and panels — the primary surface | 179 |
| `2xl` | 16 | sheets, modals, full-bleed overlays | 8 |
| `squircle` | 24 | identity avatars/tiles (new token) | 8 |
| `full` | — | pills, dots, round avatars | 152 |

`rounded-xl` went 143 → **0**. `rounded-3xl` went 10 → **2**.

**The nesting rule, which is why this could not be a codemod:** an inner surface
takes the tier *below* its parent, so the two curves stay concentric. Concretely,
a `p-1` (4px) segmented track at `lg` (8px) needs its inner buttons at **4px** —
not another `lg`, which is what they had. Fixed in `account/page.tsx`,
`fight-room.tsx` (LayerTab) and `predictions-markets.tsx` (both the sliding
indicator and the tabs, which have to agree or the indicator visibly mis-fits).
The floating menus went the other way: `popover-menu`, `language-switcher` and
`account-menu` moved to `card` (14) *because* their `p-1.5` (6px) makes their
existing `lg` (8px) items exactly right — 14 − 6 = 8.

**`--radius-squircle` (24px) is new** and exists because `rounded-3xl` was not
uniform sloppiness: it encoded two different decisions. Large overlays (sheet,
voice-claim modal, profile panels, invite hero) genuinely belonged at `2xl`. But
an 84px profile avatar at 24px is a deliberate identity look, not a container
radius, and flattening it onto the ladder would have lost that. Naming it stops
it reading as stray `3xl` — the same reasoning that added `--color-silver`
and `--color-bronze` in the first pass.

**Left at `3xl` on purpose:** `victory-card` and `event-scorecard`. These render
the share artefacts, so their radius is a shipped social asset. That is a brand
decision, not a coherence one.

### B. Two components named `Chip` → one `Badge`

`predictions/shared.Chip` is gone; its 9 call sites use `ui/badge.Badge`. Badge
gained the two tones it was missing (`hot` with the sheen, `outline`) and a
`size` axis (`sm` = 9px for dense card headers, `md` = 11px default), so the fold
is visually neutral rather than a silent resize of every prediction card.

**A name collision the original audit missed:** the two `live` tones were
different colours — `Chip.live` was **volt**, `Badge.live` is **blood**. The
Fight Pulse header now says `tone="volt"`, which is what it always rendered.
Folding blind on the name would have turned that badge red.

### C. `Button` adoption — the focus-ring gap

Measured across every raw CTA carrying a solid `blood`/`gold` fill: **40 of
them, of which 38 had no `focus-visible` ring and 31 had no `tap` press
feedback.** That is the real cost of hand-rolling — not the duplicated padding,
but that keyboard focus was invisible on nearly every primary action in the app.

26 were drop-in (already `font-display uppercase`) and were migrated to
`Button` / `ButtonLink`, each gaining the ring and the press state. Where the
element must stay an `<a>` (an external link in `article-reader`, the standalone
`claim-site-template`), it takes `buttonVariants()` instead of being forced
through `next/link`. Several outline twins sitting beside a migrated primary
moved with it so the pair still matches.

**Left alone deliberately:** 14 CTAs that are *not* uppercase display type.
Migrating them is not a style change, it re-cases the label — a content decision
that wants a human, not a sweep. Also skipped: the reels FAB and the
`rounded-full` pill CTA, which are genuinely bespoke.

`Button`'s `lg` size is `h-13`, which the first pass flagged as a possible typo
for `h-12`. It is not: sm/md/lg are 36/44/52px, an even +8px progression, and
`h-12` would break it.

### D. `.card-surface` adoption — 45 → 76 files

82 surfaces that hand-rolled exactly what the primitive encodes (card radius +
ink border + flat `ink-900`) now use it. Surfaces with a state-tinted border
(`up`, `gold`, `blood`), a gradient, or a conditional border were left alone —
they are not the plain card.

**One bug worth recording.** The first sweep matched `bg-ink-900` with a word
boundary, which also matched `bg-ink-900/60` and left a dangling `/60` behind —
producing `card-surface/60`, a class that matches nothing. 32 translucent
surfaces briefly had no background, border or radius at all. `.card-surface` is
opaque by definition and cannot express alpha, so those reverted to explicit
utilities, with the original border tint recovered from `HEAD` rather than
guessed. If this primitive ever needs a translucent variant, it has to be a
separate class — the alpha cannot ride on this one.

## Verification

| check | result |
|---|---|
| `npm run typecheck` | pass (+ 49 scripts parse) |
| `npm run lint` | **0 errors**, 54 warnings — all pre-existing hooks/TS-semantics rules (`setState-in-effect`, `rules-of-hooks`, `no-explicit-any`); none producible by a class string, a CSS token or a moved JSX comment |
| `npm test` | **799 pass / 0 fail**, 32 suites |
| `npm run build` | pass |
| compiled CSS | `text-4xs/3xs/2xs` emit **font-size only**; `.cr-touch-target:after` intact with the 44px minimums; `--color-silver`/`--color-bronze` resolve |

Re-run after the A–D pass, and all four still hold: typecheck pass (+49 scripts),
lint **0 errors / 54 warnings** (the same baseline — the 5 unused `Link` imports
the Button migration created were removed), **799 pass / 0 fail**, build pass.
Compiled CSS additionally confirms `--radius-squircle: 1.5rem` →
`.rounded-squircle`, and `.card-surface` resolving with its gradient, border and
`var(--radius-card)`.

One artefact worth knowing: `.rounded-xl` is still emitted into the bundle even
though the codebase has zero uses. Tailwind v4 scans `docs/`, and it is picking
the class name out of the prose in *this file*. It is one dead rule, not a
missed call site.

Per `CLAUDE.md`, none of this was signed off from `npm run dev`. The build check
is the production build.

**Not yet done — and now the bigger gap.** The first pass moved 552 sites by
±0.5px, which is below the threshold where a screenshot diff says anything. The
A–D pass is different: ~264 surfaces changed radius (mostly 12px → 14px), 82
gained a gradient background, and 26 buttons moved onto fixed `h-9`/`h-11`/`h-13`
heights. Those are visible changes. The surfaces that most deserve a real-device
look before merge:

- the three segmented tracks, where the inner radius was re-derived
- the prediction cards (`glass pred-card`), which went 16px → 14px
- the profile/gym identity avatars now on `rounded-squircle`
- the 26 migrated CTAs, for height and label fit
- anything using `.card-surface` where the old background was flat `ink-900` —
  it now carries the 160° gradient
