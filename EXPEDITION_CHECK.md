# Expedition Price Check — developer notes

This documents the "Expedition Price Check" widget: an OCR-based price checker for
PoE2's Expedition "Runeshape Combinations" reward panel, built into this fork. It's
written for whoever (human or agent) picks this feature up next.

**OCR engine history, read this first:** the OCR step was originally built on
Tesseract.js/OpenCV.js (the same WASM engine `HeistGemFinder.ts` still uses), then
**replaced entirely with Windows' native OCR** (`Windows.Media.Ocr`) after a
side-by-side comparison tool (`ocr-playground/`, a standalone repo — see its README)
showed it read every real item name correctly, including ones the Tesseract pipeline's
confidence scoring couldn't safely separate from icon-glyph noise, and produced zero
garbage text from the icon glyphs themselves — with no image preprocessing at all. That
comparison is worth reading before reintroducing Tesseract or any other engine; most of
the failure modes documented below were specific to Tesseract's character segmentation
and don't apply to the current engine. If you want the old Tesseract-based
implementation for reference, it's in git history (search for `ExpeditionOcr.ts`).

Provenance: the parsing/matching algorithm (quantity/name parsing, exact→prefix→fuzzy
price matching, gem-level safety rule) is ported from a separate third-party project,
a prior C#/.NET price-check tool (not part of this repo) — the *algorithm*, not
its code. That project targets a different, simpler Expedition panel (fixed-width icon
column, never wraps) and does not solve the layout problem described below.

## Architecture at a glance

**Main process** (screenshot → OCR, no game/price knowledge):
- `main/src/vision/WindowsOcr.ts` — crops the calibrated region (`cropImageFraction`,
  pure JS, no OpenCV involved), encodes it to PNG via Electron's `nativeImage`, and
  spawns `windows-ocr-recognize.ps1` (a PowerShell/WinRT bridge to
  `Windows.Media.Ocr` — there's no Node/Electron API for it) to get back text lines.
  **Not routed through the worker thread** `HeistGemFinder.ts` uses
  (`main/src/vision/link-worker.ts`/`link-main.ts`): that worker exists to isolate
  OpenCV.js/Tesseract.js's heavy *synchronous* WASM computation off the main thread,
  and this has none — spawning a subprocess is already async. `link-main.ts`'s
  `OcrWorker.ocrExpeditionPanel()` calls straight into `WindowsOcr.ts`.
- `main/build/script.mjs` copies `windows-ocr-recognize.ps1` next to the compiled
  output after each build (esbuild's bundler doesn't touch non-JS files) —
  `WindowsOcr.ts` locates it via `__dirname` at runtime, same convention
  `link-main.ts` already used for `vision.js`.
- `main/src/shortcuts/Shortcuts.ts` — `runOcrAndReply()` is the single entry point,
  called from two places: the hotkey-driven `ShortcutAction` branch, and a
  renderer-initiated `CLIENT->MAIN::request-ocr` event (used for the continuous
  re-scan/auto-close behavior — see below). Both paths log to `Settings → Debug`.
  Already guarded to no-op off Windows (`process.platform !== "win32"`) from before
  this engine switch — Windows OCR doesn't add a new platform restriction, it was
  already Windows-only in practice.

**IPC** (`ipc/types.ts`): `ShortcutAction`'s `ocr-text` variant widened with
`target: "expedition-price"` and an optional `region`; new `CLIENT->MAIN::request-ocr`
event. The response always comes back as the existing `MAIN->CLIENT::ocr-text` event,
regardless of which path triggered it.

**Renderer** (`renderer/src/web/expedition-check/`):
- `WidgetExpedition.vue` — displays parsed/priced rows; owns the continuous re-scan
  timer that starts once a scan finds real content and auto-clears the display (and
  stops polling) after a couple of consecutive empty reads, so results disappear again
  once you close the in-game panel.
- `settings-expedition.vue` — hotkey field + the region calibration UI (drag-to-move,
  corner-drag-to-resize, plus raw numeric fields). **Important**: this is bound to
  `configWidget` (the Settings dialog's *cloned* config), not the live widget config —
  see "Non-obvious constraints" below for why that matters.
- `parsing.ts` — `normalize()`, `parseLine()` (quantity + name extraction), and
  `resolveGemKey()` (the gem-level safety rule).
- `price-match.ts` — `buildPriceIndex()` / `resolvePrice()`, the exact → digit-folded →
  prefix → fuzzy chain, using the already-installed `fastest-levenshtein` package.
- `region.ts` — the shared `DEFAULT_REGION` constant for newly-created widget instances.

**Price data**: no new network code. `renderer/src/web/background/Prices.ts` gained one
addition, `getFlatPriceEntries(types)`, which re-parses the same overview JSON blob
`PRICES_DB` is already built from (kept in a separate `PARSED_OVERVIEWS` variable) —
it's a pure read of already-fetched data.

## The layout problem, and why it stopped mattering

**Useful background even though it's no longer an active problem** — it explains why
this feature reads whole rows including icons rather than cropping them out, and why a
future engine swap should be validated against it again.

The Runeshape Combinations panel's layout is not fixed. Each reward entry is a bar
containing a strip of colored modifier-icon squares (glyphs — not text, not confined to
a fixed-width column) and a "Nx Item Name" text label:

- Few icons / short name → icon strip and text share **one line** (single-height bar).
- Many icons (6-8+) or a long name → the **same bar becomes taller**: icons occupy the
  full width of the top portion, text drops to its own line below, still within one
  visually-grouped bar.
- Row count varies from 1 to 9+ depending on what the game rolled.

**Consequence**: there is no fixed "text-only column" that can be cropped to exclude
icons — in the two-line case, icons occupy the *entire* bar width. A region calibrated
generously enough to catch the text in that case necessarily also captures the modifier
icons. The OCR engine is therefore always fed real reward text mixed with colored
icon-glyph noise, in a proportion that varies unpredictably by which layout the current
combination happens to render as.

Under Tesseract, this produced three distinct, well-characterized failure modes
(dark-border-skews-Otsu, icon-glyphs-misread-as-plausible-text, and an unexplained
missing row) that took real effort to characterize and partially mitigate — see git
history for `ExpeditionOcr.ts` and the original version of this document if you need
that history. **Windows OCR does not exhibit any of them**, validated against every
real test capture available (including the exact image that used to reproduce the
missing-row case — it now reads correctly): no image preprocessing of any kind is
applied, and it produced zero garbage text from icon glyphs across every test. Whether
that holds up under significantly more real-world use than the test set covers is
still worth watching, but there's no known reason to expect the old failure modes to
resurface — they were specific to Tesseract's classic character-segmentation approach,
which the current engine doesn't use.

### The one real quirk found so far: quantity-prefix digit substitution

Windows' recognizer consistently reads the digits `1` and `0` as the look-alike
letters `I`/`O`, specifically in the leading quantity-prefix token — `"1x"` comes back
as `"IX"`, `"10x"` as `"IOX"` — never elsewhere in a line, and never for other digits
(`2x`, `3x`, `5x` etc. read correctly). `WindowsOcr.ts`'s `normalizeQuantityPrefix()`
fixes this with a line-start-anchored regex before any line reaches the renderer's
`parsing.ts`. This matters more than it might look: `parsing.ts`'s
`MULTIPLIER_PATTERN` requires actual digits, so without this fix a real `"10x"` reward
would silently lose its quantity (or worse, fail to parse as a known item at all) —
confirmed directly: unnormalized `parseLine("IOX Chaos Orb")` returns
`{quantity: 1, name: "iox chaos orb"}` (garbage name, wrong quantity), while the
normalized `parseLine("10x Chaos Orb")` returns the correct `{quantity: 10,
name: "chaos orb"}`.

`parsing.ts` still contains several Tesseract-specific tolerances (`DIGIT_FOLD_MAP`
reversing 0→o/1→l/5→s/8→b, `TRAILING_BARE_STACK_COUNT`'s `[\dlioOSB]` letter-for-digit
class) that don't correspond to anything Windows OCR actually produces. They're
harmless dead tolerance, not wrong — left in place rather than stripped out, since
removing them buys nothing and a future engine swap might reintroduce a need for
similar tolerance.

## Non-obvious constraints for future work

- **`main/src/**` edits trigger an automatic Electron restart** (esbuild's dev watcher
  in `main/build/script.mjs`), and **config never saves to disk while running via
  `npm run dev`** (`ConfigStore.ts` intentionally no-ops file writes when
  `process.env.VITE_DEV_SERVER_URL` is set, to protect the real user config from a dev
  session). Combined: every `main`-process edit during development wipes the
  currently-configured widget (region, hotkey) on restart. Minimize/batch
  main-process-side changes during active testing; renderer-side edits hot-reload
  without this cost.
- **The capture region is stored as fractions (0..1) of the game window, not pixels** —
  `ExpeditionCaptureRegion` in `renderer/src/web/overlay/widgets.ts`,
  `cropImageFraction` in `main/src/vision/utils.ts`. Deliberately DPI/resize-proof by
  construction; don't switch this to absolute pixels.
- **Calibration writes to `configWidget` (the Settings dialog's cloned config), not the
  live widget config.** This is intentional, not an oversight: `SettingsWindow.vue`'s
  "Save" does a wholesale overwrite of live config from that clone, so anything that
  mutated live config directly while Settings happened to be open would get silently
  reverted the instant Save is pressed (this was a real, confusing bug before the fix —
  dragging the region appeared to work, then reverted on Save). Do not move calibration
  back to mutating live config without redesigning around this.
- **`usePoeninja()`'s price fetch is already throttled app-wide** (~31 min between
  actual fetches, gated by 20 min of recent "interest", 4 min retry-on-failure
  heartbeat) via a `createGlobalState` singleton shared by every widget. Calling
  `queuePricesFetch()` liberally (as this widget does, once per OCR result including
  the ~1.5s auto-close poll) is safe and does not cause redundant API calls — this is
  pre-existing, shared infrastructure, not something added for this feature.
- **Global hotkeys re-register on every config update while the game is active** (a fix
  in `Shortcuts.ts`'s `updateActions()`) — without this, a hotkey configured while
  already in-game (the normal case; nobody alt-tabs out just to set a hotkey) would
  silently never take effect until the next alt-tab. If a newly-set hotkey doesn't
  fire, check this logic before assuming it's an OCR/region problem.

## What's implemented vs. not

**Implemented**: hotkey-triggered single scan; continuous re-scan + auto-close-detection
once a scan finds real rows; drag-to-calibrate region (move + resize handles, correctly
scoped to survive Settings' save flow); quantity/name parsing and exact/prefix/fuzzy
price matching; the gem-level "never guess" safety rule; a raw-OCR debug toggle
(`showRawOcr`); Windows OCR's quantity-prefix digit-substitution fix.

**Not implemented / deferred**: a standalone "continuous scan mode" toggle (today's
polling only piggybacks on auto-close-detection *after* a hotkey-triggered scan, it
isn't an independent always-on mode — `ExpeditionWidget.mode`/`pollIntervalMs` exist in
the type but aren't fully wired to a settings UI); any confidence/row-drop indicator in
the UI (also less relevant now - `Windows.Media.Ocr` doesn't expose a per-word
confidence score at all, unlike Tesseract); localization (English-only parsing/matching).

There is no more image-preprocessing tuning UI (dark-edge-trim, threshold mode,
upscale, HSV mask, PSM mode, character whitelist) - it was removed along with the
Tesseract engine it existed to tune, since Windows OCR needs none of it. If a future
engine swap needs similar tuning again, `ocr-playground/` (a separate repo) is the
place to build and validate it interactively before wiring it back into settings UI -
that's exactly what it's for, and it's how this replacement itself was validated.

**Planned but not started**: a second, user-selectable price source (poe2scout,
24h-averaged - more stable than poe.ninja's latest-listing snapshot) - see
[EXPEDITION_PRICE_SOURCES.md](./EXPEDITION_PRICE_SOURCES.md) for the researched
plan, including why the obvious CORS blocker isn't actually one. Also speculative:
tracking the gilded/succession-rune layer of the Combinations panel (which reward
row carries the more valuable long-term modifier, not just the higher-priced item)
- see [EXPEDITION_RUNE_TRACKING.md](./EXPEDITION_RUNE_TRACKING.md) for the scoped
feature proposal, entirely unbuilt.

## File map

```
ipc/types.ts                                       IPC contract (ShortcutAction, request-ocr event)
main/src/vision/WindowsOcr.ts                       crop -> PNG -> Windows.Media.Ocr bridge
main/src/vision/windows-ocr-recognize.ps1           the PowerShell/WinRT bridge script itself
main/src/vision/link-main.ts                        OcrWorker.ocrExpeditionPanel (calls WindowsOcr directly)
main/src/vision/utils.ts                            cropImageFraction
main/build/script.mjs                               copies the .ps1 next to compiled output
main/src/shortcuts/Shortcuts.ts                     runOcrAndReply, hotkey + poll trigger paths
renderer/src/web/expedition-check/
  WidgetExpedition.vue                              display + auto-close polling
  settings-expedition.vue                           hotkey field + region calibration UI
  parsing.ts                                        normalize / parseLine / resolveGemKey
  price-match.ts                                    buildPriceIndex / resolvePrice
  region.ts                                         DEFAULT_REGION
renderer/src/web/overlay/widgets.ts                 ExpeditionWidget, ExpeditionCaptureRegion
renderer/src/web/overlay/widget-registry.ts          registration
renderer/src/web/settings/SettingsWindow.vue         menu routing ("expedition-check" case)
renderer/src/web/Config.ts                          hotkey → ShortcutAction wiring
renderer/src/web/background/Prices.ts               getFlatPriceEntries (price data reuse)
renderer/specs/expedition-check/                    unit tests for parsing.ts / price-match.ts
```
