# Rune detection fixtures

Real Runeshape Combinations captures plus hand-dictated ground truth, used by
`specs/vision/expedition-runes/panel-detection.test.ts`.

```
npx vitest run specs/vision/expedition-runes   # grade against the baseline
UPDATE_RUNE_BASELINE=1 npx vitest run specs/vision/expedition-runes  # re-record
```

## What this suite is for

**It measures; it does not gate.** Border detection reads a few pixels of a
stylised in-game frame and is genuinely brittle. Individual cells will be wrong
at any given moment and that is not a broken build. Every run prints an accuracy
table, and the test fails only when a number drops below `baseline.json` — the
accuracy this code has actually reached. Improve something, re-record, and the
new number becomes the floor.

Accuracy as of 2026-09-17 (11 captures, 19 rows, 95 cells):

```
rows 17/19   cell counts 17/19 rows exact   tier 85/87 (97.7%)   cage 87/87 (100%)
```

Two rows are missed entirely, both in `Basic_test_1` — that capture's single-row
crop finds no row at all, which also costs the first row of `rows_cropped_2rows`.
Their cells drop out of the tier/cage denominators, which is why those read 87
rather than 95.

The two remaining tier misses are the `oath` cell in the two graded
`Basic_test_1` rows: it has a real blue frame, drawn *inside* a gilded cage, and
the blue peak in the sampling window reads 0.17 against a `ringFloor` of 0.4.
Not chased yet — understand it before moving that floor.

At the time of the port these read `tier 79/82` and `cage 74/87`. Both moved on
2026-09-17: the cage gain is a real detector fix, the tier gain is partly a fix
and partly four ground-truth cells that turned out to be recording the cage (see
`ground-truth/opulent_rune_example/row_6cells_1x_perfect_chaos_orb.json`).

## Adding a capture

1. **Take the screenshot.** Any crop of the panel works — a single row, several
   rows, or the whole window. Tight single-row crops are the most useful for
   isolating a specific rune or border colour.

2. **Convert it to BMP.** Fixtures are 24-bit BMP, not PNG, because
   `@wokwi/bmp-ts` is already a dependency of this package (`HeistGemFinder`
   decodes `heist-lock.bmp` with it), so the suite needs no image-decoding
   dependency of its own.

   ```powershell
   Add-Type -AssemblyName System.Drawing
   $img = [System.Drawing.Image]::FromFile("in.png")
   $bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
   $g = [System.Drawing.Graphics]::FromImage($bmp); $g.DrawImage($img, 0, 0, $img.Width, $img.Height); $g.Dispose()
   $bmp.Save("images/group/out.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
   ```

   Group related captures in a subfolder; the loader walks recursively and the
   subfolder becomes part of the test's name.

3. **Write the ground truth**, at the same relative path under `ground-truth/`
   with a `.json` extension. Dictate what you can actually see, row by row from
   the top, cell by cell from the left.

4. Run the suite. It reports a new fixture's numbers without failing (no
   baseline exists for it yet), then re-record with `UPDATE_RUNE_BASELINE=1`.

## Schema

```jsonc
{
  "notes": "free text - where the capture came from, what makes it interesting",
  "source": "optional: the file this was derived from, if any",
  "image": "group/capture.bmp",        // relative to specs/fixtures/images
  "region": null,                       // or {x,y,width,height} as fractions (0-1) of the image
  "rows": [
    {
      "rewardText": "1x Warding Rune of Hollowing",
      "cells": [
        { "tier": "none", "carriesForward": false, "runeId": "ward" },
        { "carriesForward": true, "runeId": "soul" }
      ]
    }
  ]
}
```

- **`tier`** — `"none"`, `"gold"`, `"blue"` or `"purple"`: the colour of *this
  rune's own* frame. **Omit the key entirely when you don't know the colour** and
  that cell is skipped for this check. `"none"` is a claim that the border is
  plain, which is different from not knowing. Filling a missing one in from
  whatever the detector currently reports would make this file agree with the
  code by construction.

  **The name is wrong and is being kept only until the field is replaced.** This
  field records the **frame colour**, and the frame is *not* the rune's tier —
  measured 2026-09-17, see `EXPEDITION_LEAGUE_MECHANIC.md` §5.1. The tier is
  carried by the **glyph's ink colour** and is fixed per rune shape; the frame is
  per-panel state that the same rune has in one capture and not in another. Two
  practical consequences when dictating: only `"none"` and `"blue"` occur in
  practice (nothing has a gold or purple *frame* — a gold frame is the cage, and
  belongs in `carriesForward`), and a cell with a purple glyph is `"none"` here
  unless its frame is also coloured.

- **`carriesForward`** — is this cell inside the separate, larger gold cage that
  marks the Remnant's succession pick? Independent of `tier`: a cell can have its
  own blue frame *and* be the caged one. **A row with no cage at all is normal**
  and `false` everywhere is a real answer, not a gap.

- **`runeId`** — optional, and **not graded here**. Identity is resolved in the
  renderer from the reward text, never from pixels (see
  `EXPEDITION_RUNE_PORT_PLAN.md`). It is recorded for the renderer-side tests and
  because it is the most valuable thing in a dictation.

- **`rewardText`** — also not graded here; this suite never runs OCR. Kept for
  the OCR and renderer-join tests.

Rows and cells are matched **by index**, not by name. A count mismatch is
reported as its own number and the rows that do line up are still graded, because
partial signal is what you want while iterating.

## Provenance

The 11 files here were ported from `ocr-playground/fixtures/ground-truth/`, whose
own README has the longer account of how the dictation was done and what was
cross-checked against the poe2db recipe table. Three files there are not ported:
they were never verified (`"skip": true`) on that side either.

`ocr-playground/fixtures/PANEL_GEOMETRY_NOTES.md` is worth reading before tuning
any threshold — it records the measurements *and* the confident wrong diagnoses
this work has already made once.
