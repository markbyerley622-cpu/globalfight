# Tournament provider — bouts for the bracket sports

Wrestling, taekwondo, judo, sambo and BJJ do not publish a fight card. They
publish a **bracket**, and a bout exists only as two adjacent cells in a rendered
elimination tree. The wikicard provider cannot read them: it looks for the
MMA/boxing results table (`Weight | Red | def. | Blue | Method | Round | Time`),
which these sports never produce.

This provider reconstructs bouts from tournament structure instead.

**Local only.** Nothing here is wired into `runner.ts` or a cron route. The entry
point is `npm run bouts:fill`.

## Source coverage — read this before promising a sport

Established by running the parsers against live English Wikipedia, not assumed:

| Sport | Per-division sub-articles | Brackets | What we get |
|---|---|---|---|
| **Wrestling** (UWW worlds + Olympics) | ✅ 30 per championship | ✅ | Full tree, R64 → final, both bronze matches. 19–51 bouts per division |
| **Taekwondo** (WT worlds + Olympics) | ✅ 16 per championship | ✅ | Full tree. 19–72 bouts per division |
| **Judo** (IJF worlds + Olympics) | ✅ 15 per championship | ✅ | Full tree. 25–50 bouts per division (not in the default sport list — pass `--sport=judo`) |
| **Sambo** (FIAS worlds/Europeans) | ❌ none | ❌ | Medal table only → **the final only**, derived |
| **BJJ** (ADCC worlds) | ❌ none | ❌ | Medal table only → **the final only**, derived |

Sambo and ADCC are the honest limit: English Wikipedia carries their medallists
and nothing else. There is no bracket to parse, so there is no round of 16 to
recover — and none is invented. If bout-level sambo/BJJ history matters, it needs
a different source (FIAS results, ADCC's own site), not a better parser.

## What a bout is allowed to claim

- **Winner** comes from the template's **bold** marking, which is consistent across
  all three bracket sports. Falls back to the higher trailing score, and when
  neither settles it the bout is written `SCHEDULED` — a pairing without an
  outcome is still a real fact.
- **Method is never set.** A bracket gives a score (`10`, `11F`, `VSU`, `1s1`), not
  a method. Mapping a technical superiority or an ippon onto a boxing enum
  (`KO`/`TKO`/`UD`/`SUB`) would invent a plausible-looking fact.
- **`origin: "medal-final"`** marks the derived bouts. In single elimination the
  gold and silver medallists contested the final and gold won it — stated by the
  table, not guessed. The bronze matches are *not* derived: the table names the
  bronze medallists but not who they beat. The report counts derived bouts
  separately from bracket bouts, always.
- **No date, no event.** A card whose page carries no parseable date is skipped
  rather than dated by guess.

## Event granularity

Different by sport, because the source's granularity is:

- **Brackets** → one event per **division**. Each is its own sub-article with its
  own date and a 15–70 bout tree. A whole championship as one row would be a
  300-bout "card" that no event page can render.
- **Medals only** → one event per **championship**. There is one derivable bout per
  division, so a per-division event would be a card of one bout. Sambo splits into
  two events, because sport sambo and combat sambo are different sports to us and
  share one page.

Note that a taekwondo world-championship division legitimately runs to ~70 bouts,
which is above the `OVERSIZED_CARD` (40) heuristic `run-wikicards.mts` uses to flag
season-page over-attach. Here it is not a symptom.

## Files

| file | role |
|---|---|
| `grid.ts` | rowspan/colspan-aware table grid — the whole trick (see its header) |
| `bracket.ts` | grid → bouts: competitor cells, round headers, pairing, winner |
| `medals.ts` | medal table → division finals, for the sports with no bracket |
| `wiki.ts` | page fetch (shared honest client), sub-article links, infobox date/venue |
| `config.ts` | per-sport: page-title patterns, governing body, bout format |
| `map.ts` | → `NormalizedEvent` / `NormalizedFightStub` |
| `sync.ts` | orchestration; returns a harvest, persists nothing |

Pure/impure split matches the other providers: everything except `wiki.ts` and
`sync.ts` is pure and covered by fixture tests.

## Running it

```bash
npm run bouts:fill                              # sambo, taekwondo, bjj, wrestling
npm run bouts:fill -- --sport=wrestling --years=5
npm run bouts:fill -- --sport=all --divisions=20   # includes judo
npm run bouts:fill -- --dry-run                 # harvest + report, write nothing
npm run bouts:fill -- --report                  # per-sport table only, no network
LOG_LEVEL=warn npm run bouts:fill               # quiet the per-request fetch log
```

Flags: `--sport` (`wrestling|taekwondo|judo|sambo|bjj|all`), `--years` (default 4),
`--divisions` (per championship, default 12), `--dry-run`, `--report`.

### Traps, already fixed and regression-tested

**One sport can use two different markups.** The Olympic judo brackets print
`11 Jorre Verstraeten (BEL)`; the World Judo Championships brackets print a bare
`Jorre Verstraeten`. Requiring the country code parsed 12 of 48 division pages and
reported the other 36 as *"no bracket found"* — our over-strict pattern wearing a
source-coverage costume. A cell is now accepted either by the country form **or**
by the structural signal a bracket guarantees: a text cell whose right-hand
neighbour is a score cell. Fixing that took judo from 12 events to 48.

**Seed numbers are sometimes inside the name cell.** `18 Andrea Carlino (ITA)`
became a fighter called "18 Andrea Carlino", with that slug — so the same athlete
was two people across the Olympic and world brackets. 25 rows were created that way
before it was caught. `SEED_PREFIX` strips it.



`slugify` collapses `+` to a hyphen, so **`Men's +80 kg` and `Men's 80 kg` produce the
same slug**. persist.ts upserts a new event by slug, so the heavier division did not
create a row — it overwrote the lighter one and hung its bouts there, merging two
Olympic taekwondo cards into one 40-bout event. `disambiguateName()` renders the plus
as "over" for the event NAME only (the division label on the bout stays verbatim).
Every bracket sport has a `+N kg` class directly above an `N kg` class, so this would
have hit judo and wrestling too.

Prints a per-sport count **before** and **after**, because "the scraper ran" and
"the database gained bouts" are different claims.

Re-running is safe: fight identity is the corner pair on the event, so a second
run updates instead of duplicating.

## Tests

`npm run test:tournament` — Node's built-in runner over **real captured** Wikipedia
HTML in `__tests__/fixtures/`. Every bug these parsers have had came from the gap
between how a bracket looks and how it is marked up (rowspan spacers, headings
wrapped in `div.mw-heading`, the gym in a `<small>`); synthetic markup would have
passed all of them.

## Attribution

Wikipedia text is CC BY-SA 4.0 — the same basis as the `wikipedia-facts` registry
entry. Provenance is written as source `wikipedia-tournament`, deliberately
distinct from wikicard's `wikipedia` so `cleanup:wikicards` cannot sweep these
rows and vice versa.
