// Colour primitives for reading rune cell borders.
//
// Ported from ocr-playground/rune-vision.js, reduced to just the pieces the
// panel detector actually uses. The playground also carries a dHash/template
// identity matcher; that is deliberately NOT ported yet - identity here is
// resolved from the reward text via combo-logic.ts, which needs no sprite
// library at all and is the path that actually measured well. See
// EXPEDITION_RUNE_PORT_PLAN.md.
//
// !! CHANNEL ORDER !!
// The playground worked on RGBA (canvas pixels). Everything here works on
// BGRA, because that is what `PoeWindow.screenshot()` produces and what
// `cropImageFraction` passes through - the same assumption HeistGemFinder.ts
// already encodes with its COLOR_BGR2GRAY / COLOR_BGR2HSV calls. This is not a
// cosmetic difference: with the channels swapped, red and blue trade places, so
// a gold cage border (hue ~20-32) would read as blue and every cage would be
// missed while plain cells reported as tiered. Any future caller feeding RGBA
// in here must convert first.

import { cv } from "../wasm-bindings";

export interface HueBandThresholds {
  satMin: number;
  goldMin: number;
  goldMax: number;
  purpleMin: number;
  purpleMax: number;
  blueMin: number;
  blueMax: number;
}

export type HueBand = "gold" | "blue" | "purple";

export interface BandPeak {
  /** highest single-column coverage of this band, in [0,1] */
  max: number;
  /** column index within the crop where that peak sits */
  at: number;
}

export type HueBandColumnProfile = Record<HueBand, BandPeak>;

/**
 * BGRA -> HSV, hue in OpenCV's 0-179 range.
 *
 * Plain `COLOR_*2HSV`, not `_FULL` (0-255), because every hue threshold in this
 * feature is expressed on the 0-179 scale it was measured on. Caller owns the
 * returned Mat.
 */
export function toHsvMat(bgraMat: any): any {
  const bgr = new cv.Mat();
  cv.cvtColor(bgraMat, bgr, cv.COLOR_BGRA2BGR);
  const hsv = new cv.Mat();
  cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV);
  bgr.delete();
  return hsv;
}

/** BGRA -> single-channel grayscale. Caller owns the returned Mat. */
export function toGrayMat(bgraMat: any): any {
  const gray = new cv.Mat();
  cv.cvtColor(bgraMat, gray, cv.COLOR_BGRA2GRAY);
  return gray;
}

/**
 * Per-band strongest COLUMN in a crop: for each tier hue band, the highest
 * single-column coverage found and where it sits.
 *
 * Sampling one thin ring at a fixed offset assumes you already know exactly
 * where a border is, and at these cell sizes a 1px ring one pixel off the line
 * reads bare parchment instead - which is how a blue-framed rune came back as
 * "none" during development. A caged cell also has TWO borders at different
 * offsets (the cage outside, the rune's own frame a few px in) and the offset
 * between them is not fixed. Scanning a window of columns and taking each
 * band's peak finds whatever borders are actually there without needing either
 * offset - and `at` is what lets the caller tell the outer cage from the inner
 * tier frame afterwards.
 */
export function hueBandColumnProfile(
  hsvMat: any,
  thresholds: HueBandThresholds,
): HueBandColumnProfile {
  const rows: number = hsvMat.rows;
  const cols: number = hsvMat.cols;
  const data: Uint8Array = hsvMat.data;
  const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  const best: HueBandColumnProfile = {
    gold: { max: 0, at: 0 },
    blue: { max: 0, at: 0 },
    purple: { max: 0, at: 0 },
  };
  for (let x = 0; x < cols; x++) {
    let gold = 0;
    let blue = 0;
    let purple = 0;
    for (let y = 0; y < rows; y++) {
      const idx = (y * cols + x) * 3;
      const h = data[idx];
      const s = data[idx + 1];
      if (s < thresholds.satMin) continue;
      if (inRange(h, thresholds.goldMin, thresholds.goldMax)) gold++;
      else if (inRange(h, thresholds.purpleMin, thresholds.purpleMax)) purple++;
      else if (inRange(h, thresholds.blueMin, thresholds.blueMax)) blue++;
    }
    const counts: Array<[HueBand, number]> = [
      ["gold", gold],
      ["blue", blue],
      ["purple", purple],
    ];
    for (const [band, count] of counts) {
      const coverage = count / rows;
      if (coverage > best[band].max) best[band] = { max: coverage, at: x };
    }
  }
  return best;
}

/**
 * Fraction of pixels in one column, over [yMin, yMax), whose hue falls in
 * [hueMin, hueMax] at sufficient saturation.
 *
 * The same per-pixel hue-band test as above, applied per column over an
 * explicit y-range, so a border-line search can treat a strongly-coloured
 * column as a candidate boundary the same way a strongly-dark one already is.
 */
export function columnHueBandCoverage(
  hsvMat: any,
  x: number,
  yMin: number,
  yMax: number,
  hueMin: number,
  hueMax: number,
  satMin: number,
): number {
  const cols: number = hsvMat.cols;
  const data: Uint8Array = hsvMat.data;
  let matched = 0;
  const height = yMax - yMin;
  if (height <= 0) return 0;
  for (let y = yMin; y < yMax; y++) {
    const idx = (y * cols + x) * 3;
    const h = data[idx];
    const s = data[idx + 1];
    if (s >= satMin && h >= hueMin && h <= hueMax) matched++;
  }
  return matched / height;
}
