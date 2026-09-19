# Porting rune tracking from `ocr-playground` — build plan

Branch: `feature/expedition-rune-tracking`, cut from `feature/expedition-check`
at `c892993a` (which is therefore a clean fallback point — it contains the
working reward-text OCR and nothing from this feature).

Scoping and rationale live in [EXPEDITION_RUNE_TRACKING.md](./EXPEDITION_RUNE_TRACKING.md);
the mechanic itself in [EXPEDITION_LEAGUE_MECHANIC.md](./EXPEDITION_LEAGUE_MECHANIC.md).
This doc is only *how the port is sequenced* and *why it's shaped this way*.

## The constraint that drives every decision

**The reward-text OCR currently works, and must keep working identically.**
Not "keep passing its tests" — keep its behaviour, its timing, and its
accuracy unchanged whether rune tracking is on, off, or broken. So rune
tracking is not a mode of the existing feature; it is a second feature that
happens to read the same screenshot.

Concretely, when the setting is off, **no detection code runs at all** — not
"runs and hides the result". The off-switch is upstream of the work, in the
request itself.

## The architectural finding that shaped the design

The renderer **never receives pixels**. Today's path is:

```
Shortcuts.ts  poeWindow.screenshot()          → full-window BGRA ImageData
              OcrWorker.ocrExpeditionPanel()  → direct call, NOT via the worker
              → crop → PNG → powershell → Windows.Media.Ocr → text lines
              → IPC "MAIN->CLIENT::ocr-text" { paragraphs, rows[{text,y,height}] }
```

Only text crosses to the renderer. Rune detection needs the pixels, so it
cannot live in the widget where the current parsing does.

It does not need to. The vision **worker thread** already exists
(`link-worker.ts`), already has OpenCV bound (`wasm-bindings`), and already
runs `findHeistGems` there. And the playground's dependency on OpenCV turns
out to be shallow — `cvtColor`, `Mat`, `Rect`, `resize`, `matchTemplate`,
`Size`, all of which that binding already provides. So the detection core
ports into `main/src/vision/` essentially as-is.

That placement also gives the isolation requirement for free:

```
                    ┌─ ocrExpeditionPanel()  → subprocess  → "ocr-text"
  one screenshot ───┤   (main thread, unchanged)
                    └─ detectExpeditionRunes() → worker thread → "expedition-runes"
                        (only when detectRunes: true)
```

One capture, two independent paths, two independent replies. They are on
different threads (worker vs. subprocess), so rune detection cannot delay the
OCR reply even when both are on — which is what "timing unaffected" has to
mean in practice. Reusing the one screenshot rather than taking a second also
avoids the two layers seeing *different frames* of the panel.

## Status

Phases 1-4 are built and committed. Phase 5 is not started; the design leaves
room for it but nothing is scaffolded yet.

**What has actually been verified:** both projects typecheck, both lint clean,
the esbuild worker bundle contains the new detector, and 51 renderer tests pass
(26 of them new, ported from the playground's suite). One test,
`specs/web/client-log.test.ts`, fails — it was checked against a clean stash of
the parent commit and fails identically there, so it is pre-existing and
unrelated.

**What has NOT been verified:** the feature running against the live game. That
needs Path of Exile 2 open on the Combinations panel, which cannot be done from
here. So the detection accuracy numbers quoted below come from ocr-playground's
fixtures, not from this codebase, and the first real run should be treated as
the actual test. In particular the BGRA/RGBA change (see above) is the kind of
thing that typechecks perfectly while being visibly wrong on screen — if every
cage reads as blue-tiered, or no cage is ever found, that conversion is where
to look first.

## Build order

Each phase is committable on its own and leaves the app working.

### Phase 1 — the detection core ✅
What landed, and where it ended up:

| From `ocr-playground` | To | Notes |
|---|---|---|
| `rune-vision.js` | `main/src/vision/expedition-runes/rune-vision.ts` | hue bands only; BGRA |
| `panel-detector.js` | `main/src/vision/expedition-runes/panel-detector.ts` | rows, cells, tier/cage |
| `pipeline.js` (part) | `main/src/vision/expedition-runes/RuneDetector.ts` | entry point |
| `combo-logic.js` | `renderer/src/web/expedition-check/rune-identity.ts` | **renderer**, not main |
| `pipeline.js` (part) | `renderer/src/web/expedition-check/rune-value.ts` | verdicts, data loading |
| `rune-combinations/data.json` | `renderer/public/data/expedition/` | poe2db recipes |
| `rune-value/ratings.json` | `renderer/public/data/expedition/` | opinion, user-editable |

Two things moved from where this plan first put them:

- **Identity went to the renderer.** It needs the OCR text and no pixels, and
  the renderer already has the text. Putting it in main would have forced the
  vision layer to wait for OCR, coupling exactly what this design separates.
- **dHash and template matching were not ported at all.** Identity resolves
  from the recipe table, which measured far better (37/52 vs 3/52 on the
  playground's fixtures) and needs no sprite library — so no image assets ship
  and there is no reference library to build or maintain. If generic currency
  rows ever need naming, that is when to revisit it.

### Phase 2 — worker + IPC, opt-in ✅
- `link-worker.ts`: `detectExpeditionRunes(image, rect)`
- `link-main.ts`: passthrough via Comlink — unlike the OCR call, this genuinely
  needs the worker's OpenCV. It deliberately does **not** transfer the image
  buffer: the same screenshot is handed to `ocrExpeditionPanel` on the main
  thread at that moment, and transferring would detach it out from under it.
- `ipc/types.ts`: new `MAIN->CLIENT::expedition-runes` event; `detectRunes?:
  boolean` on the request-ocr payload and the `ocr-text` action
- `Shortcuts.ts`: `runRuneDetection()`, called only when `detectRunes` is set.
  Separate method, separate worker call, separate reply. Failures are logged and
  dropped — this layer sits on top of pricing that already works, so a detector
  that breaks on an unexpected panel must cost the rune hints and nothing else.
- `Config.ts`: maps the widget's setting onto the hotkey action

### Phase 3 — display ✅ (the part expected to change with use)
Per row: the price line as before, plus a second line naming each rune, and a
single ★/⚠ marker next to the price for the extremes only.

Choices worth revisiting once it has been used in anger:
- **The caged rune is underlined, not isolated.** Every rune in the row is
  named by default, because cage detection is the least reliable step and some
  panels have no cage at all — showing only the caged one would make "no cage
  found" and "missed the cage" look identical.
- **Only `trap` and `great` get a row-level marker.** Mid-range ratings are
  noise under a timer. The full verdict is still in each rune's tooltip.
- **An unresolved rune shows `?` rather than vanishing**, so the count on screen
  matches the count in the game panel.

### Phase 4 — settings ✅
In `settings-expedition.vue`, as its own section below a divider rather than
another checkbox in the list: the master toggle, and all-runes vs caged-only.
The section also states plainly that ratings are opinion and where to edit them.

### Phase 5 — run state (not started)
Room is left, not built: a carried-rune set per chain, a manual start/end
control, and flagging a row whose caged rune is already carried as a wasted
pick ("if a rune is already proliferated, picking it again is useless" is the
one piece of advice every source agrees on). Manual controls on purpose — there
is still no reliable game signal for "a new chain started", and buttons or
keybinds are confirmed acceptable.

What the current shape already gives it: `ResolvedRune` carries `runeId`, so a
carried set is just `Set<string>`, and the row renderer already has a place to
put one more marker. What it does **not** solve is reading *what was actually
selected* — nothing in either layer observes a click, and the panel closes on
selection. The honest options are (a) the user presses a key on the row they
took, (b) infer from which panel disappeared, which is fragile, or (c) detect
the already-propagating rune directly, since the game highlights it — the patch
notes mention "Added a highlight to the Rune that will be propagated". (c) is
the most promising and the least investigated.

## What is deliberately not being ported

The playground's browser UI, its dev server, its Tesseract/Windows-OCR
experiments, and its rune-sighting capture tooling. Those are a lab bench;
only the pipeline and its data come across.
