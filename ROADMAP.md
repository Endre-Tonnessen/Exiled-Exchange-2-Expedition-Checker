# Roadmap — what's next, and what's already known about it

Where planned work lives. One entry per idea, each carrying enough context that
picking it up later (or handing it to an agent) doesn't mean re-deriving what was
already worked out. **Nothing here is committed to.** Items get deleted when
they're done, or when they stop being a good idea — either is a normal outcome.

Existing docs this defers to, rather than repeating:

| Doc | What it holds |
| --- | --- |
| `EXPEDITION_LEAGUE_MECHANIC.md` | how the in-game mechanic actually works |
| `EXPEDITION_CHECK.md` | the price-check feature as built |
| `EXPEDITION_RUNE_TRACKING.md` | rune-feature scoping, features 1–5 in build order |
| `EXPEDITION_RUNE_PORT_PLAN.md` | what was ported from the playground, and what deliberately wasn't |
| `EXPEDITION_OCR_PERFORMANCE.md` | **the** performance analysis — measured numbers, ranked options, one dead end |
| `LOCAL_DIVERGENCE.md` | every change this fork makes to upstream's own files |
| `main/specs/fixtures/README.md` | how to add a rune-detection fixture |

The overarching direction: **the feature, its tests, and its tooling should all
live in this repo.** `ocr-playground/` was the prototyping sandbox; every reason
to open it should eventually become a reason to open this app instead.

---

## Where things stand today

```
cd main && npx vitest run          # 31 tests
cd renderer && npx vitest run      # 54 tests  (one pre-existing failure in client-log.test.ts — not ours)
```

Rune detection accuracy, graded over 11 real captures (19 rows, 95 cells):

```
rows 17/19   cell counts 17/19 exact   tier 79/82 (96.3%)   cage 74/87 (85.1%)
```

That suite **measures, it does not gate** — it fails only when a number drops
below `main/specs/fixtures/baseline.json`. Re-record after an improvement with
`UPDATE_RUNE_BASELINE=1 npx vitest run specs/vision/expedition-runes`.

---

## 1. Debug / visualisation view inside the app

**Goal:** replace the reason to open `ocr-playground/` — load a capture, see the
detected rows and cells drawn on it, see why a cell was classified the way it
was, without leaving the app.

**Why it's cheaper than it looks:** the detector already computes the diagnostic
data and then throws it away. `ClassifiedCell` in `panel-detector.ts` carries
`profile` — the per-hue-band peak coverage and the column it was found in — and
`RuneDetector.ts` drops it when mapping to `RuneCellResult`. `CellRect.plate`
(the measured parchment plate inside a cell's frame) is discarded the same way.
The expensive part is done; the work is not discarding it and drawing it.

**What it actually needs:**
- One worker method alongside `detectExpeditionRunes`, returning profiles,
  plates and diagnostics (`link-worker.ts`, `link-main.ts`, `ipc/types.ts`).
- A Vue view that draws the returned *fractional* rects over a canvas. The
  capture-region calibration UI is precedent for image-region work in the
  renderer.
- An image source. A **file picker** is the one that makes this a playground
  replacement — and it's the same path the fixture workflow uses. The live
  hotkey screenshot is the easier second mode.

**Where to put it:** the settings window, not the click-through overlay. Gate it
behind the existing alphas/dev flag so it isn't shipped UI.

**The version worth building first:** load a fixture BMP *plus its ground truth*
and draw expected-vs-detected together. That turns "tier 79/82" into "here is the
cell it got wrong and here is its hue profile", which is the one thing the
playground is still genuinely needed for.

**Known limit:** threshold sliders can't write back to `DEFAULT_TIER_THRESHOLDS`
(a `const` in main). Tuning stays "adjust in the UI → hand-edit the constant →
re-run the suite", unless thresholds are made overridable through the debug call
for experimentation only.

---

## 2. More rune-detection fixtures

The highest-value, lowest-risk item on this list. Adding captures costs an hour
and immediately sharpens every number above. See `main/specs/fixtures/README.md`
for the schema and the PNG→BMP recipe.

Specific gaps, roughly in order of value:

- **The 5 undictated cells.** Five caged cells in the ported fixtures have no
  `tier` key because the original dictation named no colour for them. They're
  skipped for that check, which is why the tier denominator is 82 and not 90.
  Naming those colours is the cheapest accuracy signal available.
- **The 3 unported playground fixtures.** `FullWindowsWith9plus...`,
  `ManyModifersandLongName3...` and `PlayerSkills2ManyModifers` are the hard
  cases — 7 rows, two-line rows, a garbled title bar. They were never verified on
  the playground side either (`"skip": true`), so porting them means dictating
  them from scratch. They're where the interesting failures live.
- **Captures the current set has none of:** a panel with no cage anywhere, a
  hovered row (the game tints a whole row gold on hover — `classifyRowCells`
  defends against exactly this and nothing tests it), purple-tier borders (the
  set has blue and gold but no purple), and a 4K/non-1080p capture.

---

## 3. More tests around what already exists

- **`digitFold` has no direct test** (`renderer/src/web/expedition-check/parsing.ts`).
  It's exercised only indirectly through `price-match`.
- **`stripTrailingStackCount`'s OCR-confusion arm is untested** — the
  `TRAILING_BARE_STACK_COUNT` regex accepts `xl`/`xI`/`xO`/`xS`/`xB` as a trailing
  stack count and nothing covers that branch.
- **No renderer-side join test.** Identity resolution is tested on synthetic
  input; nothing feeds it a *recorded* detector output plus *recorded* OCR lines
  and checks the final displayed rows. This is the end-to-end coverage the
  playground had and the fork's two-package split gave up. Both halves are plain
  JSON, so it needs no pixels and no OCR bridge — just the recordings.
- **Nothing tests `ocrExpeditionPanel` itself.** It needs Windows + the
  PowerShell bridge, so it belongs in a separate opt-in suite, graded against the
  `rewardText` already sitting in every fixture.

---

## 4. OCR performance

**Read `EXPEDITION_OCR_PERFORMANCE.md` before touching any of this.** It has the
measured breakdown, five ranked options, a "do not redo" list, and one option
(D — capturing a sub-region) that is *blocked and closed*: `electron-overlay-window`'s
`screenshot()` takes no arguments, so there is no sub-region capture to be had.

Short version of what's open, in the doc's own order:

- **A — skip OCR when the region's pixels haven't changed.** Recommended first,
  self-contained, fails safe. **Starts with a measurement, not a patch:** if the
  panel is never bit-identical between frames (hover highlights, animated
  effects), the whole option is worthless, and finding that out is cheap.
- **B — keep one PowerShell process alive.** The biggest per-call win (~300 ms →
  ~30–50 ms) and the most work: crash restart, shutdown, a framed protocol.
- **C — stop writing a PNG to the temp directory.** Two independently measurable
  sub-options: send Gray8 instead of BGRA, and send something uncompressed.
  Pairs naturally with B.
- **E — lower the poll rate.** Cheapest possible change, but it buys performance
  by removing behaviour.

Worth noting alongside: the rune detector currently costs a few milliseconds per
capture on these fixtures, so it is not where the time goes. OCR is.

---

## 5. Island Rumours — a second mechanic, same pipeline shape

**What:** Logbooks reveal Uncharted Waters, and each carries up to three **Island
Rumours** — flavour-text lines like "Fallen Stars" or "Wild, Roaming Free". Each
line maps to a specific destination island with a specific modifier set, and the
game gives **no indication whatsoever** of which are worth taking. The value
spread is enormous: "Fallen Stars" → Moor / Runestones is top-tier; "Wild,
Roaming Free" → Grazed Prairie / Azmeri Spirits is bottom. Read the list, mark
each line with its tier, in place.

This is the same problem the rune work solves — *the game shows you a choice and
helps you not at all* — on a different screen. Same technical shape too: capture
region → OCR → fuzzy-match against a closed catalog → overlay the verdict. That
makes it a second application of this app's existing architecture rather than
scope creep.

### Data already staged

`ocr-playground/rumours/data.json` — **19 rumours**, tiered `S+` to `D`, with
`{ id, name, aliases[], map, mods, rating, category }`. Human-compiled from real
screenshots; provenance in `ocr-playground/rumours/SOURCE.md`, and the longer
write-up of the mechanic is section 3 of `ocr-playground/FEATURE_ROADMAP.md`.

Cross-checked against poe2db (2026-09-17) and it holds up: every island the two
sources share agrees on its reward — Castaway → Gold, Untainted Paradise → Exp,
Moment of Zen → the travelling merchant, and Obscure Island / Secluded Temple /
Mournful Cliffside / Sprawling Jungle → Olroth / Uhtred / Vorana / Medved
respectively. Two independent compilations agreeing on every overlapping point is
better evidence than either alone.

**It is incomplete, though, and now demonstrably so.** poe2db lists *The Fractured
Lake* (mirrored rares, Fragmented Mirror) and *The Jade Isles* (three Manoki
bosses); neither is in the staged 19. The staged file's own note guesses "~30+
real rumours". Reconciling the two lists is a self-contained task that needs no
code.

### Check this before believing the framing

The staged research puts the rumour list on the world map's **Uncharted Waters**
panel, attached to a **Logbook**. **Sagas appear to be a different thing**: a Saga
forces a specific boss encounter when used on unexplored waters (Aldur's Saga is
the odd one out — it grants map affixes instead). If that is right, rumours are
read off the logbook/waters panel and Sagas are a separate guarantee mechanism
used alongside them, not the thing that displays rumours.

This matters because **the capture region depends on it** — it decides which
screen this feature even points at. Confirm it in game before designing anything.

Nice connection either way: the price check **already reads Saga names**. The
unported fixture `ocr-playground/fixtures/ground-truth/PlayerSkills2ManyModifers.json`'s
sibling capture has five of them in one reward panel — Aldur's, Olroth's,
Vorana's, Uhtred's, Medved's. So Sagas are themselves Expedition rewards flowing
through the existing OCR path today.

### The one question that decides the cost

**Rumour lines render in the game's handwritten italic parchment font.** Windows
OCR is calibrated on the block text of reward rows and reads it near-perfectly;
there is no reason to assume it transfers. The staged data's `aliases[]` field
exists precisely because the font produces mangled variants ("Nothin' to drink",
"Somethin' fishy").

**Spike this first, before building anything.** One screenshot of the panel
through the existing bridge answers it:

- **If Windows OCR reads it** — this is a cheap feature. Pure text, no pixels, so
  it lives entirely in the renderer alongside `rune-identity.ts`: no OpenCV, no
  worker thread, no `main/` work beyond pointing OCR at a second region. Cheaper
  than the rune layer was.
- **If it doesn't** — the cost changes category. It needs a Tesseract path with
  real preprocessing, which means pixel work in `main/`, a second engine, and its
  own fixture suite. `ocr-playground/preprocess.js` has prior art. Worth knowing
  *before* committing, not after.

### Sketch, assuming the cheap path

- **Data** → `renderer/public/data/expedition/rumours.json`, same as
  `rune-combinations.json` and `rune-ratings.json`. Split it the way runes are
  split: facts (island, mods) separate from opinion (rating), so the tier list
  stays user-editable without touching the catalog.
- **Matching** → reuse the *algorithm* in `price-match.ts`, not the prices. Its
  exact → digit-folded → prefix → fuzzy ladder is generic string resolution, and
  it should work **better** here: 19–30 entries is a far smaller closed vocabulary
  than the price index, so the thresholds can be much looser before collisions
  become possible. `buildPriceIndex` keys by normalised name; a rumour index keys
  by name *and* every alias, which is the same shape.
- **Panel discrimination** → needs its own version of `looksLikeGemReward`. Stray
  world text drifting into a capture region already caused a bug once (a chest
  label appearing as a phantom row); a different screen gets a different
  "is this panel actually open" rule, derived the same way — from real captures.
- **Overlay** → `ExpeditionRow.vue`'s pattern (a verdict positioned against an OCR
  line's own bounding box) transfers directly, since `ExpeditionOcrLine` already
  carries `y`/`height` fractions per line.
- **Separate widget, not a mode of the existing one.** Different screen, different
  capture region, different calibration. Sharing the widget would mean sharing the
  region, which is exactly wrong.
- **Tests** → `main/specs/fixtures/` now exists and takes a new group by dropping
  files in. A rumours group needs its own captures and ground truth; if the
  Tesseract path turns out to be necessary, the pixel suite is already there to
  host it.

### Honest sizing

Bigger than anything else on this list even on the cheap path, because it is a
whole second feature: data, matching, a panel detector, a widget, settings,
calibration, tests. The staged tier data and the existing OCR bridge remove real
chunks of it, but not most of it. **Do the font spike, then decide** — that is a
half-hour of work that determines whether the rest is days or weeks.

---

## 6. Known defects

- **`Basic_test_1`'s single-row crop detects zero rows.** Reproducible, graded,
  and pinned in the baseline at 0 so it can only improve. It also costs the first
  row of `rows_cropped_2rows`, which is the same capture. Their cells drop out of
  both accuracy denominators. Item 1's debug view would likely explain this in
  seconds; without it, `detectRowBands` is where to start.

---

## 7. Retiring the playground

Not a single task — the end state of the items above. `ocr-playground/` stops
being needed once: the debug view (1) covers visual troubleshooting, the fixture
suite (2) covers regression measurement, and any remaining detector work happens
against `main/specs/fixtures/`. The playground's `rune-sightings/` (46 labelled
single-cell crops) and `rune-icons/` (33 reference sprites) have **not** been
ported and currently have no use here — `EXPEDITION_RUNE_PORT_PLAN.md` explains
why the image-matching path they exist for was dropped in favour of resolving
identity from the reward text. Revisit only if generic currency rows ever need
naming.

`rumours/data.json` is the other thing still living there (see 5). Unlike the
sprite sets it has a clear future use, so the playground cannot be fully retired
until Island Rumours is either built here or written off.

---

## Adding to this file

Keep an entry to: what, why, where the code is, what's already been figured out,
and what would be wasted effort. The point is that a future reader doesn't repeat
the investigation. Record dead ends as prominently as plans — the OCR doc's
blocked option D has already saved that investigation twice.
