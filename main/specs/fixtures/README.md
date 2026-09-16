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

Accuracy when the fixtures were first ported (11 captures, 19 rows, 95 cells):

```
rows 17/19   cell counts 17/19 rows exact   tier 79/82 (96.3%)   cage 74/87 (85.1%)
```

Two rows are missed entirely, both in `Basic_test_1` — that capture's single-row
crop finds no row at all, which also costs the first row of `rows_cropped_2rows`.
Their cells drop out of the tier/cage denominators, which is why those read 82
and 87 rather than 90 and 95.

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
  plain, which is different from not knowing. Five of the 95 ported cells have no
  `tier` for exactly this reason — they were dictated as having a bright border
  with no colour named — and filling them in from whatever the detector currently
  reports would make this file agree with the code by construction.

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
