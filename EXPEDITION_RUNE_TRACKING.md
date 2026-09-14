# Succession-rune tracking — feature scoping (proposal, nothing built yet)

Status: **speculative roadmap, not started.** No ticket, branch, or code exists for any
of this yet. Written to capture the scoping discussion before it's lost, for whoever
(human or agent) picks it up next — same spirit as
[EXPEDITION_CHECK.md](./EXPEDITION_CHECK.md).

Read [EXPEDITION_LEAGUE_MECHANIC.md](./EXPEDITION_LEAGUE_MECHANIC.md) first — this doc assumes familiarity with the gilded/succession-rune mechanic it describes. It also
draws on prior art from a sibling third-party project (not named here) that has independently built most of this already; treat
that project as a source of *design ideas*, never of copied code (it's a separate
codebase under its own license, and this repo's owner has flagged it as
build-don't-trust for execution purposes — inspiration only).

## Why this gap exists

The existing "Expedition Price Check" widget prices the *reward* on each
Combinations-panel row. It has no visibility into the *second* axis of the same
decision: which gilded rune each row carries forward, whether that rune has already
been picked this chain, and how valuable it is relative to the alternatives on
screen. Per the mechanic doc, that second axis is often the higher-value half of the
decision, especially early in a chain — so pricing only the reward is, structurally,
optimizing half the problem.

## Architecture requirement: independent, toggleable layers (2026-09-14)

**Hard requirement, not a nice-to-have:** succession-rune tracking must be a
layer the user can disable entirely, with the existing, already-working
reward-text OCR completely unaffected either way. Concretely — turning rune
tracking off must mean *zero* row/cell detection work happens, not just "the
results are hidden"; and rune tracking being on or off must never change
reward-text OCR's behavior, timing, or accuracy. The two are separate
settings, not one feature with an internal switch.

This has a real implication for how reward-text OCR itself should be called
once both layers exist together: the current widget's approach (per its own
`EXPEDITION_CHECK.md`) is one capture, one Windows OCR call, multiple lines
back. That should stay exactly as-is — a first draft of the equivalent
pipeline in `ocr-playground` initially made one OCR call *per detected row*
instead, which was both slower (repeated subprocess spawns) and not
representative of the real approach; switching to one whole-panel call with
each returned line matched to a detected row band by vertical position
afterward fixed both. If rune tracking ever needs reward text (e.g. for the
combination-table lookup, Feature 2(b)), it should consume the *result* of
the existing OCR call, never trigger a second one or change how the first
one runs.

Validated hands-on in `ocr-playground`'s "Analyze Panel" tab, which ships
exactly this as two genuinely independent toggles — see that project's
README for how to try both in isolation.

## Proposed features, in build order

Each feature is independently shippable and delivers value on its own — this isn't
an all-or-nothing bundle. Difficulty uses the same T-shirt sizing (`S`/`M`/`L`/`XL`)
this project's own conventions elsewhere use for effort.

### 1. Gilded Cell Highlight
**Intent.** The stated problem is "I'm not an expert on this mechanic" — right now
nothing on screen calls out which of the ~5 icons in a row's strip is the one that
matters. A new/casual player has to spot a gold border under time pressure.

**Scope.** Detect the gilded-bordered cell(s) in each row's icon strip and draw a
callout on the overlay. No rune identity, no scoring — purely "this one matters, the
other four don't."

**Benefit.** Immediate, low-risk education; directly answers the stated gap.

**Risk.** Low. Worst case is a visually wrong highlight, not a bad in-game decision.

**Technical note.** EE2 deliberately dropped the OpenCV/Tesseract pixel pipeline when
it moved to Windows OCR (see `EXPEDITION_CHECK.md`'s OCR-engine-history section) —
this doesn't reintroduce that. Electron's `nativeImage`, already used in
`WindowsOcr.ts` to encode the cropped region to PNG before OCR, can be read for raw
pixel color directly; border-hue sampling on a handful of small regions needs no CV
library. The layout-problem section of `EXPEDITION_CHECK.md` already establishes that
the icon strip's pixels are inside the existing capture region (that was the
documented *problem* for text OCR) — which is good news here: no new capture region
or calibration step is needed, just a second read of a bitmap that's already being
produced.

**Difficulty: S**

### 2. Rune Identity Resolution
**Intent.** Knowing *a* cell is gilded isn't enough on its own — value varies
meaningfully by which specific rune it is (see the mechanic doc's tier table:
`Opulent` alone is worth stacking, `Oath` is a trap pick despite also being gilded).

**Scope.** Resolve each gilded cell to a specific rune, drawn from the 34-rune
catalog.

**Update, 2026-09-13 — corrected twice now; current understanding below.**
First pass concluded approach (b) was ruled out: it seemed to depend on a
combination *name* (e.g. "Skyfall") appearing somewhere in the panel to OCR, and
neither the project owner's recollection of the panel nor a check of poe2db.tw
found any such thing shown in-game. That was too broad a conclusion. Reading
that tool's `RUNE-24` after it actually shipped (it was unbuilt,
`Grooming` status, on the first pass) showed why: **"Skyfall" isn't a separate
combination label — it's the literal name of the skill/support gem, or unique
rune item, that combination grants, shown as the reward text the game already
displays** (`"Skill Level 20: Skyfall"`). That's the *same* reward-name field
this project's widget already OCRs for pricing — no new capture region, ever.
The lookup only stays unresolved for generic currency rewards ("3x Chaos Orb"),
where the same text is plausibly produced by many different combinations — and
it stays unresolved *safely* (returns null, never a wrong guess) rather than
failing outright. Confirmed against a real, passing test in the source project
(`RuneCombinationFixtureTests`, run against an actual screenshot), not just
design notes. **So: approach (b) is real, working prior art for named-reward
rows specifically — not a dead end, and not the universal answer either.**
Approach (a) (visual recognition) remains necessary regardless, since it's the
only approach that covers generic currency rows at all.

**Three identity techniques now worth comparing** (all explored as real prior
art elsewhere; a hands-on
comparison of all three now lives in the sibling `ocr-playground` project —
see its README's "Rune fingerprint (gilded ID)" and "Combination table
lookup" sections):

| | (a) Perceptual hash (dHash) | (a′) Template matching (`cv.matchTemplate`) | (b) Reward-name table lookup |
|---|---|---|---|
| How | Reduce the icon to a 64-bit "shape fingerprint"; compare new crops by bit-difference (Hamming distance) against a saved library | Slide a clean reference icon image across the candidate region and score pixel-correlation (`TM_CCOEFF_NORMED`) — the exact technique already proven in production for icon recognition (`HeistGemFinder.ts`, Heist gems) | Normalize the row's existing reward text, look it up in a static `(name → rune order)` table, read off the rune at the gilded index |
| Covers | Every row (needs a labeled library) | Every row (needs a reference/template library) | Only rows with a named (non-currency) reward |
| New OCR/capture needed | No | No | No — reuses the existing reward-text field |
| Reference data needed | Yes — sprite library, build your own (see below) | Yes — same library | Yes — a combinations table; a real 211-entry poe2db.tw one is now available (see below) |
| Already built here | Yes — `ocr-playground`'s "Rune fingerprint" tab | Yes — `ocr-playground`'s original "Template match" tab is content-agnostic; works for this today | Yes — `ocr-playground`'s "Combination table lookup" tab |

**Testing infrastructure, 2026-09-13:** `ocr-playground` now has a structured test
suite rather than one-off manual checks — `npm test` runs pure-logic unit tests for
the combination-table lookup (no screenshots needed, 22 tests covering
normalization, fuzzy matching, ambiguity handling, and a regression test pinned to a
real result), and a new "Fixtures & tests" tab lets real screenshots be annotated
once with ground truth and then re-run automatically against all three identity
techniques (tier detection, dHash, template match), reporting pass/fail per method.
This is the mechanism to actually settle the recommendation below with evidence
instead of a guess, once enough screenshots are annotated — see that project's
README for how to use it.

**Recommendation:** these aren't mutually exclusive — a real implementation would
likely run (b) first wherever the reward is named (highest confidence, cheapest:
plain string lookup, no image work at all) and fall back to (a)/(a′) for currency
rows. Between (a) and (a′), try template matching first — it's already sitting
there, proven in production, and likely to need fewer example crops per rune than
getting dHash's distance thresholds dialed in. Keep the border/tier HSV detection
either way — that answers a different question (is this cell gilded, and roughly
how valuable a tier) and isn't affected by which shape-identity technique wins.

**Reference data — build your own icon library.** Crop a reference glyph
per rune from your own screenshots, the same discipline the playground
already teaches for the currency/item vocabulary. The combinations table is
a separate matter and comes from poe2db.tw (see
`renderer/public/data/expedition/README.md`).

**Production-calibrated numbers worth reusing, not re-deriving from scratch**
(from prior art on this panel):
- **Hamming-distance "same rune" threshold: 8 bits**, out of a 64-bit dHash.
  Their own measurements: same rune 1–3 bits apart normally, distinct runes
  22+ bits apart — a wide margin — but one observed same-rune outlier at 13
  bits, caused by a row clipped at the capture's top edge. Worth using 8 as a
  starting cutoff and specifically testing a clipped/partial-row capture
  before trusting it.
- **A real false-positive mode for any border-color/tier detector:** the game
  tints an entire combination row gold while the cursor hovers it, lifting
  every cell's raw gold-color reading together — a naive absolute-threshold
  detector would flag every cell in a hovered row as gilded. Their fix
  compares a cell's reading against a sample of nearby row background
  (contrast, not an absolute cutoff). Any implementation here needs the same
  contrast check, not just a hue/saturation threshold.
- **A tried-and-abandoned idea, worth not repeating:** using glyph hue alone
  to infer a sprite's tier/weight before it's been named. Their own
  measurement: the same rune's gold-pixel count varied from 72 to 162 between
  two sightings — landing on opposite sides of any reasonable threshold. Hue
  is a fine rough hint, never authoritative for scoring.
- **Icon-cell geometry**, useful if automatic gilded-cell detection (Feature 1)
  gets built: cell height runs **~1.9× the row's own text-line height**
  (resolution-independent, since both render at the same UI scale), and icon
  strips can span up to **80% of the panel width** on wide (6+ icon) rows.

**Risk.** Medium — unlike Feature 1, a *wrong* label actively misleads a decision.
Needs an explicit "unknown/unconfirmed" state rather than ever guessing silently.

**Difficulty: M** — depends on Feature 1 for cell detection.

### 3. Glossary Tooltip
**Intent.** Bundle education directly into identity resolution — once you know which
rune a cell is, showing what it actually does is nearly free and is exactly the kind
of thing a non-expert player benefits from mid-run.

**Scope.** Hovering/showing a resolved rune displays its name and real in-game effect
text (e.g. "Opulent — Increased Monster Rarity").

**Benefit.** Directly teaches the mechanic while playing, no separate lookup needed.

**Risk.** None beyond Feature 2's — worst case is a stale effect description.

**Technical note.** Requires compiling your own verified rune-name/effect/tier
reference table — compile it from poe2db.tw directly rather than reusing another tool's
catalog file, the way
`EXPEDITION_LEAGUE_MECHANIC.md` already did for the subset quoted there.

**Difficulty: S** (once Feature 2 exists)

### 4. Per-Run Carried Set ("don't double-dip")
**Intent.** This is the concrete ask from the original scoping conversation: stop
wasting a pick on a gilded rune that's already active in the current chain.

**Scope.** Track which resolved rune identities have already propagated this
Expedition chain; flag a row's gilded rune as "already carried — this pick adds
nothing" when it repeats.

**Benefit.** Directly prevents the wasted-pick failure mode the mechanic doc
describes.

**Risk.** Low-medium. Known limitation, confirmed independently by both this
project's mechanic doc and the source project's own design notes: **there is no
reliable game signal for "a new Expedition chain started."** Neither codebase parses
`Client.txt`/zone transitions today, and building that would be a new subsystem, not
an extension of this feature. Ship a manual reset hotkey/button and say so plainly,
rather than guessing at auto-detection and getting it wrong.

**Difficulty: M** — mostly state management + UI; depends on Feature 2.

### 5. Weighted Row Recommendation
**Intent.** The actual min-max payoff, and the reason this whole feature set exists:
surface the "take worse currency now for the better long-term rune" trade-off as one
legible signal instead of requiring the player to mentally combine two numbers.

**Scope.** One blended score per row = existing reward price + Σ weight(new,
not-yet-carried gilded runes in that row). Replaces/augments the current
price-only rank coloring.

**Benefit.** The concrete decision-support outcome the original ask was scoping
toward.

**Risk.** Weight values are inherently subjective — no authoritative source for
"how much is a Bond rune worth relative to a Time rune" was found anywhere during
research, and the source project hit the identical wall and shipped hand-authored
placeholder weights, user-editable from day one (see its `RUNE-2`/`RunesOptions`
design). Expect to do the same: ship a starting guess, make it editable immediately,
tune from experience rather than waiting for data that doesn't exist.

**Difficulty: M** — depends on Features 2 and 4 both being trustworthy first; a
wrong score here is worse than no score, so this should ship last, not in parallel.

## Explicitly not recommended right now

- **Community-sourced weight data.** No such dataset exists anywhere found during
  research. Not worth building toward until/unless one appears.
- **Automatic chain-boundary detection.** No zone/log parsing exists in either
  codebase today. A manual reset hotkey (Feature 4) solves the same problem far more
  cheaply than a new log-parsing subsystem would.

## Suggested entry point

Features 1+3 (highlight + glossary) as a first slice: cheapest, purely educational,
no risk of steering a decision wrong, and it directly answers "I don't understand
this mechanic yet" while still playing. Features 4+5 (the actual
scoring/recommendation) are the real payoff but should land only after Feature 2's
identity resolution is trusted — a wrong recommendation is worse than an absent one.
