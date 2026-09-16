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
rows 17/19   cell counts 17/19 exact   tier 85/87 (97.7%)   cage 87/87 (100%)
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
and draw expected-vs-detected together. That turns "tier 85/87" into "here is the
cell it got wrong and here is its hue profile", which is the one thing the
playground is still genuinely needed for. Worth knowing before building it: the
2026-09-17 session got exactly this signal out of a throwaway vitest file that
dumped per-cell profiles and a raw HSV column scan to the console, plus
PowerShell `System.Drawing` to crop and nearest-neighbour-upscale a cell to
6–14x. Neither is a substitute for the real view, but the cheap version found a
mechanic-level error in a few minutes, so don't treat the Vue work as a
prerequisite for looking at pixels.

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

- ~~**The 5 undictated cells.**~~ Done 2026-09-17 — the tier denominator is now
  87, the same as the cage one.
- **The 3 unported playground fixtures.** `FullWindowsWith9plus...`,
  `ManyModifersandLongName3...` and `PlayerSkills2ManyModifers` are the hard
  cases — 7 rows, two-line rows, a garbled title bar. They were never verified on
  the playground side either (`"skip": true`), so porting them means dictating
  them from scratch. They're where the interesting failures live.
- **Captures the current set has none of:** a panel with no cage anywhere, a
  hovered row (the game tints a whole row gold on hover — `classifyRowCells`
  defends against exactly this and nothing tests it), a panel where the blue
  frame sits on a rune *other* than the caged one and other than
  stone/power/oath (the four captures have only those three, which is why what
  the blue frame means is still open — see item 6), and a 4K/non-1080p capture.
  A purple *border* is no longer on this list: measurement says none exists, and
  the frame only ever comes up plain or blue.

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

## 5. Known defects

- **`Basic_test_1`'s single-row crop detects zero rows.** Reproducible, graded,
  and pinned in the baseline at 0 so it can only improve. It also costs the first
  row of `rows_cropped_2rows`, which is the same capture. Their cells drop out of
  both accuracy denominators. Item 1's debug view would likely explain this in
  seconds; without it, `detectRowBands` is where to start.

- **The two `oath` tier misses.** `Basic_test_1`'s oath cell has a real blue
  frame drawn *inside* a gilded cage, and the blue peak in the classification
  window reads 0.17 against a `ringFloor` of 0.4, so it reports `none`. It is the
  only cell in the set with a blue frame nested inside a cage, so it may be the
  cage crowding the window rather than the floor being wrong. Explain it before
  touching `ringFloor`.

---

## 6. Stop reading the tier from pixels

**The finding (measured 2026-09-17, written up in
`EXPEDITION_LEAGUE_MECHANIC.md` §5.1):** a rune's tier is the colour of its
**glyph**, not of any border, and it is **fixed per rune shape** — 23 identities
over 78 cells, zero conflicts, and it agrees 8/8 with the independently-sourced
tier table in §5 once you accept that blue tier is simply "not coloured". The
coloured *frame* the detector reads is per-panel state, not a tier.

**So the tier need not be detected at all.** Identity is already resolved in the
renderer from the reward text (`EXPEDITION_RUNE_PORT_PLAN.md`), and tier follows
from identity through a 34-row static table. That is free, exact, and immune to
every pixel problem this feature has had. Only the **cage** is genuinely
per-instance and has to come from the panel.

**What that would mean concretely:**
- A `tier` column on whatever table `rune-identity.ts` already keys by rune id.
  §5.1 has 9 entries confirmed two ways and 4 more (`death`, `life`, `power`,
  `soul`) confirmed from the fixtures alone; the rest are unobserved.
- `ClassifiedCell.tier` and `RuneCellResult.tier` lose their reason to exist.
  They are plumbed all the way to `rune-value.ts` but **nothing reads them** —
  no rating, no display branch — so deleting them is close to free. Check
  `settings-expedition.vue`'s mock builder, which sets `tier: "none"`.
- The fixture `tier` field would stop being a detector metric. It is still worth
  keeping as a *frame* metric if the blue frame turns out to matter (below);
  otherwise it goes, and the suite grades cages and geometry only.

**Do not start here.** Settle what the blue frame means first, because that
decides whether the frame channel is worth detecting at all:

- In each of the four capture groups **exactly one** rune identity carries a blue
  frame, and it is in **every row** of that panel: `stone` in `full_live_images`,
  `power` in both `More_complex_test_1` and `opulent_rune_example`, `oath` in
  `Basic_test_1`. Same rune, different panels, different frame — so it is not a
  rune property.
- Best candidates: the runeshape you have selected or already placed in the
  Remnant, or a hover-highlights-all-matching affordance. Both fit the data.
- **This is one in-game observation, not a pixel problem.** Open the panel, note
  which rune is blue-framed, move the mouse, look again. Ten seconds settles it
  and nothing else will.

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

---

## Adding to this file

Keep an entry to: what, why, where the code is, what's already been figured out,
and what would be wasted effort. The point is that a future reader doesn't repeat
the investigation. Record dead ends as prominently as plans — the OCR doc's
blocked option D has already saved that investigation twice.
