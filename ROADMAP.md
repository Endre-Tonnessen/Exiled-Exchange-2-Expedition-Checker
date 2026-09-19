# Roadmap — what's next, and what's already known about it

Where planned work lives. One entry per idea, each carrying enough context that
picking it up later (or handing it to an agent) doesn't mean re-deriving what was
already worked out. **Nothing here is committed to.** Items get deleted when
they're done, or when they stop being a good idea — either is a normal outcome.

Existing docs this defers to, rather than repeating:

| Doc | What it holds |
| --- | --- |
| `notes/expedition/EXPEDITION_LEAGUE_MECHANIC.md` | how the in-game mechanic actually works |
| `notes/expedition/EXPEDITION_STRATEGY.md` | how to *play* it — measured findings on tablets, node mods and runes |
| `notes/expedition/EXPEDITION_CHECK.md` | the price-check feature as built |
| `notes/expedition/EXPEDITION_RUNE_TRACKING.md` | rune-feature scoping, features 1–5 in build order |
| `notes/expedition/EXPEDITION_RUNE_PORT_PLAN.md` | what was ported from the playground, and what deliberately wasn't |
| `notes/expedition/EXPEDITION_OCR_PERFORMANCE.md` | **the** performance analysis — measured numbers, ranked options, one dead end |
| `LOCAL_DIVERGENCE.md` | every change this fork makes to upstream's own files |
| `main/specs/fixtures/README.md` | how to add a rune-detection fixture |

The overarching direction: **the feature, its tests, and its tooling should all
live in this repo.** `ocr-playground/` was the prototyping sandbox; every reason
to open it should eventually become a reason to open this app instead.

---

## Where things stand today

```
cd main && npx vitest run          # 31 tests
cd renderer && npx vitest run      # 584 tests, 2 skipped, all passing (2026-09-17)
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
  the blue frame means is still open — see item 8), and a 4K/non-1080p capture.
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

**Read `notes/expedition/EXPEDITION_OCR_PERFORMANCE.md` before touching any of this.** It has the
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

Worth noting alongside: the rune detector costs 2.2–3.6 ms per capture on these
fixtures (median of 20 runs, the 5-row panel being the slowest), so it is not
where the time goes. OCR is.

One easy win inside that, if it ever matters: `classifyRowCells` crops each cell
and converts BGRA→BGR→HSV **twice** — once per edge, since 2026-09-17 — while
`detectPanel` has already built a full-image HSV Mat and thrown it away. Passing
an ROI of that Mat down would remove every per-cell conversion and close the
BGRA-vs-HSV channel-order hazard `rune-vision.ts`'s header warns about at the
same time. Left alone deliberately: 3.6 ms against OCR's ~300 ms is not worth
a refactor of the one function this feature's correctness lives in.

---

## 5. Island Rumours — a second mechanic, same pipeline shape

**The mechanic is documented in `notes/expedition/EXPEDITION_LEAGUE_MECHANIC.md` §6** — logbooks,
Uncharted Waters, rumours, Sagas, and the sourcing caveats. Read that first; this
section is only about whether and how to build something on top of it.

**What to build:** read the rumour list and mark each line with its value tier,
in place. The game gives no indication which lines are good, and the spread is
enormous — "Fallen Stars" → Runestones is top-tier, "Wild, Roaming Free" → Azmeri
Spirits is bottom.

This is the same problem the rune work solves — *the game shows you a choice and
helps you not at all* — on a different screen, with the same technical shape:
capture region → OCR → fuzzy-match a closed catalog → overlay the verdict. A
second application of this app's existing architecture, not a new one.

### Data already staged

`ocr-playground/rumours/data.json` — **19 rumours**, tiered `S+` to `D`, with
`{ id, name, aliases[], map, mods, rating, category }`, hand-compiled from real
screenshots. Provenance in `ocr-playground/rumours/SOURCE.md`; the mechanic doc
records the poe2db cross-check (it agrees on every shared island) and the two
islands poe2db has that this set lacks.

Reconciling the two lists into a complete catalog is a self-contained task that
needs no code and could be done any time.

### Confirm the framing before designing anything

Nobody on this fork has verified in game *where* rumours appear, or that Sagas are
the separate mechanism the guides describe. **The capture region depends on it** —
it decides which screen this feature even points at. That is the first thing to
check, and it is free.

### The one question that decides the cost

**Rumour lines render in the game's handwritten italic parchment font**, not the
block text Windows OCR reads near-perfectly today. There is no reason to assume it
transfers.

**Spike this before building anything.** One screenshot of the panel through the
existing bridge answers it:

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

## 6. Game-data staleness — where a PoE2 patch breaks this fork

PoE2 is in Early Access and its data moves. This feature set rests on a pile of
game facts, and **most of them fail silently**: a stale recipe table doesn't throw,
it names the wrong rune with full confidence. This section maps what is exposed,
how each thing refreshes, and what the reliable sources are.

**Drift is not hypothetical — it is already present in the shipped files.** The
evidence is below.

### The exposure map

| What | Kind | Fails how | Refreshes how | Risk |
| --- | --- | --- | --- | --- |
| `rune-combinations.json` (314 recipes) | poe2db scrape | **Silently wrong rune names.** Identity resolution is entirely this file | **No tooling exists** — see below | **Highest** |
| `rune-ratings.json` (6 runes) | Hand-compiled opinion | Recommends a trap, or misses one | Hand-edited; no date stamp | High |
| `PANEL_GEOMETRY_DEFAULTS`, `DEFAULT_TIER_THRESHOLDS` | Pixel calibration | Rows/cells/cages misdetected after any UI restyle, or a new *frame* colour | Hand-tuned against captures | Medium — **but now has a tripwire** (§2) |
| `parsing.ts` literals — `"runeshape"`, `skill\|spirit\|support`, gem level regex | UI text | Panel-open detection and gem pricing stop working | Hand-edited | Medium; also breaks under localisation |
| `rumours/data.json` (19, incomplete) | Hand-compiled | n/a — not shipped yet | Hand-edited | Low today, inherits Highest if §5 ships |
| Prices | Live trade API | Self-correcting | Automatic | **Lowest** |
| `items.ndjson`, `stats.ndjson`, `remnants.json` | Upstream `dataParser`, GGG-derived | Upstream's problem | **Free, on merging upstream** | Lowest |

### The single biggest hole: there is no way to refresh the recipe table

`rune-combinations.json` carries `"source": "https://poe2db.tw/Runeshape_Combinations"`
and `"fetchedUtc": "2026-09-14T03:34:15Z"`. Good provenance — but the script that
produced it (`update-rune-combinations.ps1`) lives in the read-only sibling project
and was **deliberately not copied**. Neither this repo nor the playground can
re-scrape.

So today, refreshing the single highest-risk file means writing a scraper from
scratch. **Writing that script is the highest-value item in this section**, and it is
worth doing before it is needed rather than during a patch scramble.

### Evidence the drift is already here

Upstream ships `renderer/public/data/remnants.json` — GGG-derived remnant data,
regenerated on their "data update" commits (last one 2026-09-05), and **read by
nothing in the app**. It overlaps our poe2db scrape, so the two can be compared.
Doing that (2026-09-17) found:

- **All 252 reward names in our scrape appear in upstream's data.** Zero missing.
- **`volcanic` in our data is `Gasp` in upstream's — 13 of 13 rewards reachable via
  `Gasp` have `volcanic` in the poe2db recipe, with no exceptions.** That is a
  naming divergence or an outright rename, sitting in shipped data right now.
- Reconstructing ordered rune lists from upstream's file and diffing: **41 recipes
  fully agree, 45 conflict** (17 where both sources are complete, 28 on a position
  both fill). The rest are gaps in upstream's file, not disagreements.

**Caveat on that analysis, which matters:** upstream's `recipes` keys are
`Rune|position|cellCount` *by inference* — 41 exact full-list agreements is strong
evidence, not proof, and the 17 complete-row conflicts may partly mean the key
format is being read wrong rather than that the data disagrees. Nobody has
confirmed which source is right on any individual conflict. **Do not "fix" either
file from the other without checking in game first.**

### Reliable sources, ranked

1. **Upstream's own data pipeline** (`dataParser/`, feeding `renderer/public/data/`).
   GGG-derived, machine-generated, and it refreshes *for free* whenever upstream is
   merged in. Most authoritative and lowest-effort thing available. It is also the
   least-exploited: `remnants.json` has been sitting there unused this whole time.
2. **The official trade API** (`pathofexile.com/api/trade2/data/*`). Authoritative
   and live; already how prices and item/stat data arrive.
3. **poe2db.tw.** Broad, structured, scrapeable, and the current source for recipes —
   but community-maintained and, per the above, demonstrably diverges from upstream.
   Good as *a* source, bad as the *only* source.
4. **GGG patch notes / the official forum.** Not machine-readable, but the
   authoritative answer to "what changed", which is the signal to act on.
5. **Community wikis and guides** (Maxroll, Mobalytics, Game8, Fextralife). Fine for
   opinion and ratings, weakest for exact data. Already how `rune-ratings.json` was
   seeded, with per-entry `confidence` recorded for exactly this reason.

### What to actually do

In value order:

1. **Write the re-scrape script** and keep it in this repo. Without it the
   highest-risk file is unmaintainable.
2. **Turn the upstream comparison into a standing test.** Cross-check
   `rune-combinations.json` against `remnants.json` and fail on new disagreements.
   That converts a one-off investigation into a tripwire that fires the next time
   either side moves — and it costs nothing at runtime, since upstream's file is
   already in the repo.
3. **Settle `volcanic` vs `Gasp`** in game, and record the answer wherever it lands.
4. **Stamp every owned data file** with `source` + `fetchedUtc` + the game version it
   was taken from. `rune-combinations.json` does two of three; `rune-ratings.json`
   does none.
5. **Write down a refresh procedure per file** in
   `renderer/public/data/expedition/README.md` — that README already says "re-scrape
   after a major patch" without saying how.
6. **Re-check ratings after balance patches.** The `oath` entry already notes a
   signalled rework.

### Tripwires that exist today

Worth knowing before adding more:

- **`rune-identity.test.ts` asserts every rune id in the shipped table is one of 34
  known ids.** If a patch adds or renames a rune, that test fails — which is the
  behaviour you want. (It would have caught `gasp` had that name reached our file.)
- **The rune-detection fixture suite (§2)** is the tripwire for the *pixel*
  calibration constants. A UI restyle shows up as the accuracy table dropping,
  which is exactly what it is for.
- The app itself hardcodes no rune catalog — only that test does. Keep it that way.

---

## 7. Known defects

- **`Basic_test_1`'s single-row crop detects zero rows.** Reproducible, graded,
  and pinned in the baseline at 0 so it can only improve. It also costs the first
  row of `rows_cropped_2rows`, which is the same capture. Their cells drop out of
  both accuracy denominators. Item 1's debug view would likely explain this in
  seconds; without it, `detectRowBands` is where to start.

- **The accuracy ratchet stores numerators only.** `baseline.json` records
  `tierCorrect` / `cageCorrect` but not `tierGraded` / `cageGraded`
  (`panel-detection.test.ts`'s `Baseline` type `Omit`s them), so a fixture edit
  that adds graded cells can mask a detector regression: add N easy ones while
  losing N−1 on cells already graded, and `toBeGreaterThanOrEqual` still passes.
  This is not hypothetical — the 2026-09-17 run added `tier` to 5 previously
  undictated cells, taking `tierGraded` 20→25 in one fixture, so that commit's
  tier gain genuinely mixes new dictation with detector improvement and the
  ratchet cannot separate them. Recording the denominators and comparing ratios
  would close it, and is a few lines.

- **The two `oath` tier misses.** `Basic_test_1`'s oath cell has a real blue
  frame drawn *inside* a gilded cage, and the blue peak in the classification
  window reads 0.17 against a `ringFloor` of 0.4, so it reports `none`. It is the
  only cell in the set with a blue frame nested inside a cage, so it may be the
  cage crowding the window rather than the floor being wrong. Explain it before
  touching `ringFloor`.

---

## 8. Stop reading the tier from pixels

**The finding (measured 2026-09-17, written up in
`notes/expedition/EXPEDITION_LEAGUE_MECHANIC.md` §5.1):** a rune's tier is the colour of its
**glyph**, not of any border, and it is **fixed per rune shape** — 23 identities
over 78 cells, zero conflicts, and it agrees 8/8 with the independently-sourced
tier table in §5 once you accept that blue tier is simply "not coloured". The
coloured *frame* the detector reads is per-panel state, not a tier.

**So the tier need not be detected at all.** Identity is already resolved in the
renderer from the reward text (`notes/expedition/EXPEDITION_RUNE_PORT_PLAN.md`), and tier follows
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

## 9. Retiring the playground

Not a single task — the end state of the items above. `ocr-playground/` stops
being needed once: the debug view (1) covers visual troubleshooting, the fixture
suite (2) covers regression measurement, and any remaining detector work happens
against `main/specs/fixtures/`. The playground's `rune-sightings/` (46 labelled
single-cell crops) and `rune-icons/` (33 reference sprites) have **not** been
ported and currently have no use here — `notes/expedition/EXPEDITION_RUNE_PORT_PLAN.md` explains
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
