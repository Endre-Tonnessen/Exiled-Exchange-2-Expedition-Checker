// Row + cell segmentation for a Runeshape Combinations panel capture.
//
// Finds each reward row's bar, then the icon cells within it, then classifies
// each cell's border - all from pixel structure (border lines, gaps, hue
// coverage), with no manual cropping beyond the user's calibrated region.
//
// Ported from ocr-playground/panel-detector.js. Every constant below was
// calibrated against real captures in that project; the reasoning for each is
// kept because most of them encode a specific failure that was actually
// observed, not a preference. The playground's own PANEL_GEOMETRY_NOTES.md has
// the long-form measurements.
//
// Findings this detector depends on, one of them a correction:
//   - A cell can carry TWO independent borders at once: the succession cage
//     (always gold, marks the slot that propagates) on the outside, and the
//     cell's own frame a few px further in. They are separate systems and a
//     cell can have either, both, or neither - reading one ring collapses them.
//   - CORRECTED 2026-09-17. That inner frame is NOT the rune's tier colour, and
//     it is never gold. Measured over eleven captures: the frame comes up plain
//     brown or blue-with-rivets and is a property of the PANEL, not the rune -
//     `oath` is blue-framed in one capture and plain in two others. The rune's
//     tier is the colour of its GLYPH, which is fixed per rune shape and which
//     this file does not read at all. `ClassifiedCell.tier` therefore reports
//     the frame despite its name; EXPEDITION_LEAGUE_MECHANIC.md §5.1 has the
//     measurement and ROADMAP item 8 the case for dropping the field.
//   - The cage is not always present. Some reward panels have no gilded cell at
//     all, so "found none" is a legitimate result, not a detection failure.

// No direct OpenCV use here on purpose - every Mat this file needs is produced
// by the helpers below, so the detection logic itself stays plain array maths
// over pixel data and can be reasoned about (and eventually tested) without a
// WASM module loaded.
import {
  toHsvMat,
  toGrayMat,
  hueBandColumnProfile,
  columnHueBandCoverage,
  type HueBandColumnProfile,
} from "./rune-vision";

export interface PanelGeometry {
  marginXFraction: number;
  darkLuminance: number;
  rowLineDarkFraction: number;
  minLineGapFraction: number;
  minRowHeightFraction: number;
  maxRowHeightFraction: number;
  iconZoneHeightFraction: number;
  cellBorderColumnCoverage: number;
  minCellWidthFraction: number;
  stripEndGapMultiple: number;
  maxStripFraction: number;
}

// Every size-based constant here is a FRACTION of the image's own dimensions,
// never an absolute pixel count. That is load-bearing: an earlier version used
// absolute pixels calibrated against two ~480x550 screenshots, which silently
// found zero rows at any other capture size or UI scale. Since the capture
// region is user-calibrated and the game runs at whatever resolution the player
// uses, absolute pixels cannot work here.
export const PANEL_GEOMETRY_DEFAULTS: PanelGeometry = {
  /** Fraction of image width excluded each side before scanning for row borders - keeps the decorative outer panel frame out of the row-line search. */
  marginXFraction: 0.03,
  /** A pixel counts as "border-dark" below this luminance (0-255). A brightness cutoff, genuinely resolution-independent unlike the size constants. */
  darkLuminance: 110,
  /** A candidate row-boundary line needs at least this fraction of the scanned width to be border-dark. */
  rowLineDarkFraction: 0.6,
  /** Two candidate boundary lines closer than this fraction of image height are one line (borders have thickness). */
  minLineGapFraction: 0.006,
  /**
   * A gap between consecutive boundary lines outside this range is not a
   * plausible row. Measured against image WIDTH, not height - deliberately: a
   * row spans the full crop width by construction, so row-height-over-width
   * stays near constant (~0.12-0.16 across real captures at different UI
   * scales) no matter how much vertical padding the crop includes. Height as
   * the basis breaks the moment a user calibrates a tight region around just
   * the reward rows: that shrinks total height toward one row's height and
   * pushes a perfectly normal row past the max, yielding zero rows.
   */
  minRowHeightFraction: 0.08,
  maxRowHeightFraction: 0.4,
  /** Icon cells are searched only in this fraction of a row's height from its top - the strip sits up top; below it is reward text. */
  iconZoneHeightFraction: 0.62,
  /** A vertical run of border-dark pixels covering at least this fraction of the icon zone counts as a cell-border column. */
  cellBorderColumnCoverage: 0.7,
  /** Minimum plausible cell width as a fraction of image width - guards against noise columns 1-2px apart reading as a cell. */
  minCellWidthFraction: 0.04,
  /** A gap wider than this multiple of the cell pitch means "icons ended, text begins". */
  stripEndGapMultiple: 1.8,
  /** How far across the row the strip search runs, as a fraction of image width - stops well before it could eat into text on a narrow row. */
  maxStripFraction: 0.75,
};

export interface TierThresholds {
  satMin: number;
  goldMin: number;
  goldMax: number;
  /** saturation floor for the gold band alone - the parchment is gold-hued and clears the shared one */
  goldSatMin: number;
  purpleMin: number;
  purpleMax: number;
  blueMin: number;
  blueMax: number;
  /** minimum absolute hue-band coverage for a cell's own tier frame */
  ringFloor: number;
  /** minimum coverage above the row's median for a tier frame */
  minRingContrast: number;
  /** minimum coverage above the row's median for a gold BORDER COLUMN during cell splitting */
  minGoldColumnContrast: number;
  /** width of the edge sampling window, as a fraction of cell width */
  edgeWindowFraction: number;
  /** how far the window reaches OUTSIDE the cell's left edge, to catch a cage drawn outside the cell's own frame */
  cageOuterPadFraction: number;
  /** minimum absolute gold coverage for the succession cage */
  cageFloor: number;
  /** minimum gold coverage above the row's median for the cage */
  cageContrast: number;
}

// Hue bands are on OpenCV's 0-179 scale. The gold band is NARROW on purpose:
// this UI is drawn on warm beige/brown parchment that sits in the same broad
// hue neighbourhood as a real gold border, and a wider band (H 10-45 was tried)
// swallows the background wholesale.
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
  satMin: 60,
  goldMin: 20,
  goldMax: 32,
  goldSatMin: 100,
  purpleMin: 125,
  purpleMax: 165,
  blueMin: 95,
  blueMax: 124,
  ringFloor: 0.4,
  minRingContrast: 0.28,
  minGoldColumnContrast: 0.2,
  edgeWindowFraction: 0.22,
  // ~2px at these cell sizes. Measured: with no outward reach at all the cage
  // score tops out at 77/87 whatever else is tuned; with it, 87/87, and 0.03 to
  // 0.09 all score the same. See the note in classifyRowCells for why the cage
  // can sit outside the cell, and why reaching for it needs the both-edges rule
  // to stay safe.
  cageOuterPadFraction: 0.06,
  // REVISED 2026-09-17. This used to be 0.28 on the reasoning that gold against
  // gold-hued parchment is a narrower margin than blue or purple enjoy. The
  // margin was narrow only because the gold band shared `satMin: 60` with the
  // others, which the parchment clears: a plain cell read 0.10-0.30 gold and a
  // real cage 0.33-0.92, overlapping, so no floor could separate them.
  // `goldSatMin: 100` sits in the measured gap between parchment (S 35-99) and a
  // cage line (S 108-140) and collapses a plain cell to near zero.
  //
  // The number is the centre of a plateau in BOTH parameters: with the
  // both-edges rule in classifyRowCells, goldSatMin 80-120 x cageFloor 0.10-0.40
  // scores 87/87 throughout. An earlier attempt kept a single-edge reading and
  // pushed this to 0.52, which also scored well on these fixtures but had only
  // ~0.09 between the worst neighbour-bleed false positive (0.47) and the
  // weakest real cage (0.56). Do not take a good score as a stable threshold
  // without checking what sits either side of it.
  cageFloor: 0.25,
  cageContrast: 0.12,
};

export interface RowBand {
  top: number;
  bottom: number;
}

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** the parchment plate inside the cell's frame, when one was found */
  plate?: { x: number; y: number; w: number; h: number } | null;
}

function median(vals: number[]): number {
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Fraction of pixels in image row `y`, restricted to [xMin, xMax), darker than `darkLuminance`. */
function rowDarkFraction(
  grayMat: any,
  y: number,
  xMin: number,
  xMax: number,
  darkLuminance: number,
): number {
  const data: Uint8Array = grayMat.data;
  const cols: number = grayMat.cols;
  let dark = 0;
  const base = y * cols;
  for (let x = xMin; x < xMax; x++) if (data[base + x] < darkLuminance) dark++;
  return dark / (xMax - xMin);
}

/**
 * Finds each reward row's vertical span by locating near-full-width dark
 * horizontal lines (a row bar's own top/bottom border) and pairing consecutive
 * ones into plausible row heights.
 */
export function detectRowBands(
  grayMat: any,
  geometry: PanelGeometry = PANEL_GEOMETRY_DEFAULTS,
): RowBand[] {
  const rows: number = grayMat.rows;
  const cols: number = grayMat.cols;
  const xMin = Math.round(cols * geometry.marginXFraction);
  const xMax = cols - xMin;
  const minLineGapPx = Math.max(1, Math.round(rows * geometry.minLineGapFraction));
  // Fractions of WIDTH - see the constant's own doc comment for why.
  const minRowHeightPx = Math.round(cols * geometry.minRowHeightFraction);
  const maxRowHeightPx = Math.round(cols * geometry.maxRowHeightFraction);

  const boundaryYs: number[] = [];
  for (let y = 0; y < rows; y++) {
    if (
      rowDarkFraction(grayMat, y, xMin, xMax, geometry.darkLuminance) >=
      geometry.rowLineDarkFraction
    ) {
      boundaryYs.push(y);
    }
  }

  // Collapse runs of adjacent dark rows (a border has real thickness) into one
  // representative y each.
  const collapsed: number[] = [];
  for (const y of boundaryYs) {
    if (collapsed.length > 0 && y - collapsed[collapsed.length - 1] <= minLineGapPx) continue;
    collapsed.push(y);
  }

  const bands: RowBand[] = [];
  for (let i = 0; i < collapsed.length - 1; i++) {
    const top = collapsed[i];
    const bottom = collapsed[i + 1];
    const h = bottom - top;
    if (h >= minRowHeightPx && h <= maxRowHeightPx) bands.push({ top, bottom });
  }
  return bands;
}

/**
 * Keeps only the largest CONTIGUOUS stack of row bands.
 *
 * The panel draws its reward rows as one continuous list - measured on real
 * full-panel captures, consecutive real rows are separated by exactly 4px (the
 * shared bar border) every time. Everything the detector picks up elsewhere -
 * the decorative area below the list, the title bar above it - sits alone,
 * separated by a much larger gap (17px, 158px and 224px in the same captures).
 * So the reward list is the longest run of tightly-packed bands, and anything
 * else is panel furniture.
 *
 * Deliberately geometric, NOT "drop rows whose OCR text is empty" - even though
 * the spurious rows do all come back without a matched text line, and that
 * would be a simpler test. Rune detection and reward-text OCR must work
 * independently of each other; letting row detection depend on OCR would make a
 * row vanish from the rune layer whenever the text layer had a bad frame, which
 * is exactly the coupling this feature's design rules out.
 */
export function keepContiguousRowStack(bands: RowBand[]): RowBand[] {
  if (bands.length < 2) return bands;
  const medianHeight = median(bands.map((b) => b.bottom - b.top));
  const maxGap = Math.max(6, Math.round(medianHeight * 0.15));

  const runs: RowBand[][] = [];
  let current: RowBand[] = [bands[0]];
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].top - bands[i - 1].bottom <= maxGap) current.push(bands[i]);
    else {
      runs.push(current);
      current = [bands[i]];
    }
  }
  runs.push(current);

  let best = runs[0];
  for (const run of runs) if (run.length > best.length) best = run; // ties keep the topmost run
  return best;
}

/**
 * The parchment plate INSIDE a cell's frame - the part that actually holds the
 * glyph - measured rather than assumed.
 *
 * A cell's x/width come from real border-line detection and are precise, but
 * its y/height are `rowTop` plus a fixed fraction of row height, which consults
 * no pixel at all. So the glyph sits at a different vertical offset and scale
 * in every crop and the aspect ratio wanders (22x23 next to 40x23 within one
 * row, measured).
 *
 * Found by scanning ROWS the same way cell borders are found by scanning
 * columns: the cell's own top and bottom frame edges are dark horizontal runs
 * across its width. Candidate pairs are scored on a strong prior - cells are
 * roughly SQUARE, so the two edges should sit about one cell width apart -
 * which picks the frame out from the row bevel, the shadow under the icons, and
 * the reward text below.
 *
 * Returns null when no convincing pair is found, so the caller can fall back to
 * the unrefined rect rather than trust a bad guess.
 */
export function findCellPlate(
  grayMat: any,
  cell: CellRect,
  rowTop: number,
  rowBottom: number,
  geometry: PanelGeometry = PANEL_GEOMETRY_DEFAULTS,
): { x: number; y: number; w: number; h: number } | null {
  const cols: number = grayMat.cols;
  const rows: number = grayMat.rows;
  const data: Uint8Array = grayMat.data;
  // Two different insets, deliberately. SCANNING must stay clear of the cell's
  // own vertical borders, which are dark down the full height and would make
  // every row look like a frame edge - so rows are measured over the middle of
  // the cell only. The RETURNED plate is the full cell minus just the frame's
  // thickness: insetting the result by the scan margin too produced a 22x31
  // plate inside a 38px cell, an arbitrary inner slice with the wrong aspect,
  // which is the very thing this function exists to prevent.
  const scanInset = Math.max(1, Math.round(cell.w * 0.2));
  const framePad = Math.max(2, Math.round(cell.w * 0.08));
  const scanFrom = Math.max(0, cell.x + scanInset);
  const scanTo = Math.min(cols, cell.x + cell.w - scanInset);
  const xFrom = Math.max(0, cell.x + framePad);
  const xTo = Math.min(cols, cell.x + cell.w - framePad);
  if (scanTo - scanFrom < 3 || xTo - xFrom < 4) return null;

  const top = Math.max(0, rowTop);
  const bottom = Math.min(rows, rowBottom);
  const darkRow: number[] = [];
  for (let y = top; y < bottom; y++) {
    let dark = 0;
    for (let x = scanFrom; x < scanTo; x++) if (data[y * cols + x] < geometry.darkLuminance) dark++;
    darkRow.push(dark / (scanTo - scanFrom));
  }

  const candidates: number[] = [];
  for (let i = 0; i < darkRow.length; i++) {
    if (darkRow[i] >= geometry.cellBorderColumnCoverage) candidates.push(top + i);
  }
  if (candidates.length < 2) return null;

  // Best pair: closest to one cell width apart (square), darkest, and tall
  // enough to actually hold a glyph.
  const minH = Math.max(4, Math.round(cell.w * 0.5));
  let best: { score: number; y0: number; y1: number } | null = null;
  for (let a = 0; a < candidates.length; a++) {
    for (let b = a + 1; b < candidates.length; b++) {
      const h = candidates[b] - candidates[a];
      if (h < minH || h > cell.w * 1.8) continue;
      const squareness = Math.abs(h - cell.w) / cell.w;
      const strength = darkRow[candidates[a] - top] + darkRow[candidates[b] - top];
      const score = squareness - strength * 0.1;
      if (!best || score < best.score) best = { score, y0: candidates[a], y1: candidates[b] };
    }
  }
  if (!best) return null;

  const pad = 2; // step just inside the frame lines themselves
  const y = best.y0 + pad;
  const h = best.y1 - best.y0 - 2 * pad;
  if (h < 4) return null;
  return { x: xFrom, y, w: xTo - xFrom, h };
}

/**
 * Within one row's icon zone, finds border columns and pairs them into cell
 * rectangles left to right, stopping at the first gap wide enough to mean
 * "icons ended".
 *
 * Two independent border-column signals, unioned: near-full-height DARK runs (a
 * plain cell's thin border) and near-full-height GOLD-hued runs (a caged cell's
 * own thick frame). Gold needs its own signal rather than a looser dark
 * threshold, because gold is genuinely BRIGHT - it fails a dark test outright,
 * which is exactly why a caged cell's border used to vanish from detection
 * entirely. A pitch-arithmetic-only fix (assume a missing line always leaves one
 * clean multiple-of-pitch gap) was tried first and found unreliable against real
 * pixels: a caged cell's own content can register a short noisy dark run near
 * its true border rather than leaving an obviously oversized gap, and pitch
 * arithmetic cannot tell that from a genuine cell.
 *
 * @returns cells in full-image pixel coordinates
 */
export function detectCellsInRow(
  grayMat: any,
  hsvMat: any,
  rowTop: number,
  rowBottom: number,
  geometry: PanelGeometry = PANEL_GEOMETRY_DEFAULTS,
  thresholds: TierThresholds | null = null,
): CellRect[] {
  const cols: number = grayMat.cols;
  const zoneTop = rowTop;
  const zoneBottom = rowTop + Math.round((rowBottom - rowTop) * geometry.iconZoneHeightFraction);
  const zoneHeight = zoneBottom - zoneTop;
  const xMin = Math.round(cols * geometry.marginXFraction);
  const xMax = Math.min(cols - xMin, xMin + Math.round(cols * geometry.maxStripFraction));
  if (zoneHeight <= 0 || xMax - xMin < 4) return [];

  const data: Uint8Array = grayMat.data;
  const darkFractions: number[] = [];
  const goldCoverages: number[] = [];
  for (let x = xMin; x < xMax; x++) {
    let dark = 0;
    for (let y = zoneTop; y < zoneBottom; y++) {
      if (data[y * cols + x] < geometry.darkLuminance) dark++;
    }
    darkFractions.push(dark / zoneHeight);
    goldCoverages.push(
      thresholds
        ? columnHueBandCoverage(
            hsvMat,
            x,
            zoneTop,
            zoneBottom,
            thresholds.goldMin,
            thresholds.goldMax,
            thresholds.goldSatMin,
          )
        : 0,
    );
  }

  // The parchment this UI is drawn on is a warm beige/brown - inside the SAME
  // gold hue band as a genuine border, just at lower saturation and coverage.
  // An absolute floor alone collided (measured, back when this scan shared
  // `satMin` with the other bands: background columns often read 0.3-0.6 gold
  // coverage, a true gold border column 0.65-0.95), so it also has to stand out
  // from this row's OWN median gold coverage, the background's local baseline.
  //
  // "just at lower saturation" is now acted on rather than worked around: this
  // scan takes `goldSatMin` (100), which sits in the measured gap between
  // parchment (S 35-99) and a real gold line (S 108-140), so the background
  // barely registers. Verified as a no-op on the fixtures - same 17 rows, same
  // 17 exact cell counts - so the contrast check below is kept as the belt to
  // this braces rather than retuned on evidence that no longer exists.
  const goldBaseline = thresholds ? median(goldCoverages) : 0;

  const borderCols: number[] = [];
  for (let i = 0; i < darkFractions.length; i++) {
    const x = xMin + i;
    const darkHit = darkFractions[i] >= geometry.cellBorderColumnCoverage;
    const goldHit =
      !!thresholds &&
      goldCoverages[i] >= geometry.cellBorderColumnCoverage &&
      goldCoverages[i] - goldBaseline >= thresholds.minGoldColumnContrast;
    if (darkHit || goldHit) borderCols.push(x);
  }

  const minCellWidthPx = Math.round(cols * geometry.minCellWidthFraction);

  // Collapse adjacent border-column runs to their centre (each real border line
  // is a few px thick).
  const rawLines: number[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < borderCols.length; i++) {
    if (runStart === null) runStart = borderCols[i];
    const isLast = i === borderCols.length - 1;
    const gapToNext = isLast ? Infinity : borderCols[i + 1] - borderCols[i];
    if (gapToNext > 2) {
      rawLines.push(Math.round((runStart + borderCols[i]) / 2));
      runStart = null;
    }
  }

  // A caged cell's border is not one clean run of hit columns: it is a dark
  // inner bevel, then a small transitional gap where neither dark nor gold
  // clears its threshold, then the gold ring itself - a ~3px dip that splits
  // what is structurally ONE border into two rawLines entries. The collapse
  // above cannot bridge that without risking merging two genuinely adjacent
  // plain borders, so fix it with a fact that holds regardless of colour: two
  // REAL cell boundaries can never be closer than about a cell's minimum width,
  // since a cell has positive width by definition.
  const lines: number[] = [];
  for (const x of rawLines) {
    if (lines.length > 0 && x - lines[lines.length - 1] < minCellWidthPx) {
      lines[lines.length - 1] = Math.round((lines[lines.length - 1] + x) / 2);
    } else {
      lines.push(x);
    }
  }

  // Cells are drawn at a FIXED pitch - measured across six real captures it
  // lands at 36-39px every time, the most stable quantity in this detector.
  // Establish it once from the gaps actually found (median, so one merged or
  // spurious gap cannot move it) rather than a running median that changes as
  // the loop walks and makes the result depend on cell order.
  const gapsFound: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const w = lines[i + 1] - lines[i];
    if (w >= minCellWidthPx) gapsFound.push(w);
  }
  const pitch = gapsFound.length > 0 ? median(gapsFound) : 0;

  const cells: CellRect[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const left = lines[i];
    const w = lines[i + 1] - left;
    if (w < minCellWidthPx) continue; // not a real cell gap

    // A gap that is a clean MULTIPLE of the pitch is not the end of the strip -
    // it is N cells whose shared borders went undetected (a caged cell's border
    // is bright, and two ADJACENT caged cells hide three lines between them).
    // Measured: an opulent-row capture had a 79px gap against a 39px pitch -
    // exactly 2 cells - and the strip-end check below fired on it and discarded
    // every remaining cell in the row.
    const multiple = pitch > 0 ? Math.round(w / pitch) : 1;
    if (multiple >= 2 && Math.abs(w - multiple * pitch) <= pitch * 0.35) {
      for (let k = 0; k < multiple; k++) {
        cells.push({
          x: Math.round(left + (w * k) / multiple),
          y: zoneTop,
          w: Math.round(w / multiple),
          h: zoneHeight,
        });
      }
      continue;
    }

    if (pitch > 0 && w > pitch * geometry.stripEndGapMultiple) break; // strip really ended
    cells.push({ x: left, y: zoneTop, w, h: zoneHeight });
  }

  // marginXFraction keeps the panel's decorative outer FRAME out of the
  // border-line search, which is right for a full screenshot - but a tightly
  // calibrated region has no frame, and its first cell starts almost
  // immediately. Measured across every single-row capture: the first cell's
  // left border sits at x~3-5 while the margin starts the scan at x=14, so that
  // border is never seen and the FIRST cell is silently dropped - the whole
  // "detected 3, expected 4" off-by-one, not a trailing-edge problem.
  //
  // Rather than shrink the margin (letting the frame back in on full captures),
  // extend outward from the cells actually found: the pitch is known and
  // stable, so step one cell further out at each end and keep it only if that
  // span carries comparable INK to the cells already found.
  const columnDark = (x: number): number => {
    if (x < 0 || x >= cols) return 0;
    if (x >= xMin && x < xMax) return darkFractions[x - xMin];
    let dark = 0;
    for (let y = zoneTop; y < zoneBottom; y++) {
      if (data[y * cols + x] < geometry.darkLuminance) dark++;
    }
    return dark / zoneHeight;
  };
  const meanDarkOver = (x0: number, x1: number): number => {
    let sum = 0;
    let n = 0;
    for (let x = Math.round(x0); x < Math.round(x1); x++) {
      sum += columnDark(x);
      n++;
    }
    return n > 0 ? sum / n : 0;
  };
  if (cells.length > 0 && pitch > 0) {
    const inkFloor = median(cells.map((c) => meanDarkOver(c.x, c.x + c.w))) * 0.6;
    // Ink alone is too weak a test at the trailing end, because a row's reward
    // text sits beside the icons and is full of ink - measured, this walked two
    // phantom cells straight into the text of a 5-icon row and reported 7. A
    // real cell is a framed box, so require the candidate to yield a PLATE.
    // Text has no frame and produces none.
    const extend = (candidate: CellRect): CellRect | null => {
      if (meanDarkOver(candidate.x, candidate.x + candidate.w) < inkFloor) return null;
      const plate = findCellPlate(grayMat, candidate, rowTop, rowBottom, geometry);
      return plate ? Object.assign(candidate, { plate }) : null;
    };
    for (let added = 0; added < 2; added++) {
      const prevX = cells[0].x - pitch;
      if (prevX < 0) break;
      const cell = extend({
        x: Math.round(prevX),
        y: zoneTop,
        w: Math.round(pitch),
        h: zoneHeight,
      });
      if (!cell) break;
      cells.unshift(cell);
    }
    for (let added = 0; added < 2; added++) {
      const last = cells[cells.length - 1];
      const nextX = last.x + last.w;
      if (nextX + pitch > cols) break;
      const cell = extend({ x: nextX, y: zoneTop, w: Math.round(pitch), h: zoneHeight });
      if (!cell) break;
      cells.push(cell);
    }
  }

  for (const cell of cells) {
    if (cell.plate == null) {
      cell.plate = findCellPlate(grayMat, cell, rowTop, rowBottom, geometry);
    }
  }

  return cells;
}

export interface ClassifiedCell {
  cell: CellRect;
  profile: HueBandColumnProfile;
  /**
   * This cell's OWN frame colour - "none" when the frame is the plain brown one.
   *
   * Misnamed, and only `"none"` and `"blue"` are reachable. It is the FRAME,
   * which is per-panel state, not the rune's tier, which is its glyph ink and is
   * fixed per rune shape; and `"gold"` cannot occur because a gold frame is a
   * cage and is reported by `carriesForward`. Kept in the union only because the
   * ground-truth schema shares these names. EXPEDITION_LEAGUE_MECHANIC.md §5.1,
   * and ROADMAP item 8 for the case that this field should not exist.
   */
  tier: "none" | "gold" | "purple" | "blue";
  /** the succession cage: this slot's rune propagates to later encounters */
  carriesForward: boolean;
}

/**
 * Samples ONLY the leftmost (or rightmost) columns of a cell, not a full
 * top+bottom+left+right box ring.
 *
 * Found necessary, not stylistic: a cell's X bounds come from the same precise
 * per-column border detection that defines the cell, so x=0 / x=w-1 sit exactly
 * on the real border - but its Y bounds come from the cruder row-band
 * calculation, so a full ring's top and bottom rows are frequently 1-2px off
 * the true border and pull the average back toward plain background. Confirmed
 * by raw pixel dump: the left/right edge columns read a clean, strong border
 * hue; the top/bottom rows did not.
 */
function edgeWindowColumnProfile(
  cropBgra: (rect: CellRect) => any,
  rect: CellRect,
  thresholds: TierThresholds,
): HueBandColumnProfile {
  const bgra = cropBgra(rect);
  const hsv = toHsvMat(bgra);
  const result = hueBandColumnProfile(hsv, thresholds);
  hsv.delete();
  bgra.delete();
  return result;
}

/**
 * Classifies every cell in a detected row against that SAME row's own median
 * border reading - no separate background sample needed.
 *
 * A single averaged hue against an absolute range cannot tell "this border is
 * genuinely tiered" from "ambient lighting or a whole-row hover tint pushed a
 * plain border into the same hue range". The game really does tint an entire
 * row gold while the cursor is over it, which would flag every cell in a
 * hovered row. The fix is CONTRAST against a local baseline: this row's median
 * hue-band coverage across its own cells. Most cells in a real row are plain,
 * so the median approximates "what a plain border reads as in THIS capture" -
 * and critically it moves WITH the hover tint, so a uniformly shifted row still
 * reports "none" for every cell instead of flipping them all on.
 *
 * A row with only one cell has no meaningful median and falls back to an
 * absolute-floor-only check.
 *
 * `cropBgra(rect)` must return an owned BGRA Mat for that rect; this function
 * deletes each crop it requests.
 */
export function classifyRowCells(
  cropBgra: (rect: CellRect) => any,
  cells: CellRect[],
  thresholds: TierThresholds,
): ClassifiedCell[] {
  const samples = cells.map((cell) => {
    // A cell's borders live at its LEFT edge - except where that edge sits at
    // the image boundary and the border is cropped away with it. Sampling there
    // reads bare parchment, which is gold-hued, and reliably reported an
    // ordinary first cell as caged on every full-panel capture. Such a cell is
    // still bounded on the RIGHT by a real line, so read its TIER from that side.
    const atImageEdge = cell.x <= 1;
    const innerW = Math.max(3, Math.round(cell.w * thresholds.edgeWindowFraction));
    // Reach a few px outside the cell on the left. The cage is drawn outside the
    // cell's own frame, and `detectCellsInRow` locks onto whichever strong line
    // it finds - which for a cell that has both is the inner one. Measured: in
    // full_uncropped_5rows the same cage column lands at cell.x=83 in row 2
    // (gold peak 0.92, inside the window) and cell.x=86 in row 1 (peak 0.20 -
    // the cage is at x 83-84, three px outside it). Same cage, same strip, found
    // or missed purely on where the split fell.
    //
    // The right window pads INWARD by the same amount rather than outward, for
    // the mundane reason that this function is not told the image width and
    // cannot clamp a rect that runs past it. It does not need to reach out: a
    // caged cell's right bar measures INSIDE its own right boundary.
    const outerPad = Math.min(cell.x, Math.round(cell.w * thresholds.cageOuterPadFraction));
    const left: CellRect = {
      x: cell.x - outerPad,
      y: cell.y,
      w: innerW + outerPad,
      h: cell.h,
    };
    const right: CellRect = {
      x: cell.x + cell.w - innerW - outerPad,
      y: cell.y,
      w: innerW + outerPad,
      h: cell.h,
    };
    const leftProfile = edgeWindowColumnProfile(cropBgra, left, thresholds);
    const rightProfile = edgeWindowColumnProfile(cropBgra, right, thresholds);
    return {
      cell,
      // Tier reads one edge, as before; the cage needs both (see `cageGold`).
      profile: atImageEdge ? rightProfile : leftProfile,
      // A CAGE ENCLOSES. It has a bar at both of this cell's edges, so the
      // weaker of the two is the honest reading.
      //
      // Found necessary 2026-09-17, and it is what makes the outward reach above
      // safe. That reach reads into the 2px gutter between cells, so a caged
      // cell's RIGHT bar lands in its neighbour's LEFT window: measured across
      // the fixtures, every cell sitting to the right of a caged one jumped from
      // gold 0.00 (no reach) to 0.40-0.47 (with it), against a weakest real cage
      // of 0.56. A single absolute floor therefore had about 0.09 of room
      // between "misses real cages" and "flags every neighbour of one", which is
      // not a threshold, it is a coincidence - and the same 3px wander in cell
      // splitting that motivated the reach would close it. Taking the min drops
      // those neighbours to 0.00, because the bleed is one-sided by
      // construction. Two ADJACENT caged cells - a real case, per
      // ocr-playground's notes - still pass, since each has a bar on both sides.
      cageGold: Math.min(leftProfile.gold.max, rightProfile.gold.max),
    };
  });

  // The baseline is a LOW QUANTILE, not the median.
  //
  // `median` here returns the upper of the two middle values, so a row where
  // half the cells are caged took its baseline FROM the cages: measured on a
  // 4-cell row with 2 caged cells, ambient came out equal to the cage reading,
  // contrast went to 0, and both cages were rejected. Every 2-cell row was
  // degenerate the same way, and strictly worse than a 1-cell row, which at
  // least falls through to the absolute floor. That matters because a row can
  // carry more than one gilded rune (EXPEDITION_LEAGUE_MECHANIC.md §4) - no
  // fixture has one yet, which is why the suite could not see this.
  //
  // The 25th percentile keeps the original intent - "what does a plain border
  // read as in THIS capture", which is what makes the check survive a whole-row
  // hover tint - while staying plain until more than a quarter of the row is
  // caged.
  const bandFloorLevel = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * 0.25)];
  };
  const ambient =
    samples.length > 1
      ? {
          gold: bandFloorLevel(samples.map((s) => s.cageGold)),
          blue: bandFloorLevel(samples.map((s) => s.profile.blue.max)),
          purple: bandFloorLevel(samples.map((s) => s.profile.purple.max)),
        }
      : null;

  const qualifies = (own: number, band: "gold" | "blue" | "purple", floor: number, contrast: number) => {
    if (own < floor) return false;
    return (ambient ? own - ambient[band] : own) >= contrast;
  };
  const isTier = (s: (typeof samples)[number], band: "blue" | "purple") =>
    qualifies(s.profile[band].max, band, thresholds.ringFloor, thresholds.minRingContrast);
  const isCage = (s: (typeof samples)[number]) =>
    qualifies(s.cageGold, "gold", thresholds.cageFloor, thresholds.cageContrast);

  return samples.map((s) => {
    // Gold in the edge window means the cage, full stop. There is no positional
    // test here any more, and no gold `tier`.
    //
    // RETRACTED 2026-09-17, by measurement. Both used to exist to separate "the
    // cage's gold" from "the rune's OWN gold frame", on the strength of an
    // opulent rune being gold-tiered AND caged. Scanning a caged opulent cell
    // column by column shows it has no gold frame to separate: outside-in it
    // reads cage gold (H~20-24, S~110-120, V~170-200), then the SAME dark brown
    // frame every other cell has (H~11-15, S~95-110, V~135), then parchment. A
    // caged `protective` cell one fixture over has the identical structure. The
    // gold that was read as opulent's "tier" is its GLYPH, which is drawn in
    // gold ink on the plate - a different thing in a different place, and the
    // reason the fallback looked right. See EXPEDITION_LEAGUE_MECHANIC.md §5.1.
    //
    // The positional gate cost real cages: it rejected gold peaks at window
    // offsets 5-7, which is simply where the cage line lands when cell
    // splitting puts the cell's left edge a pixel or three inside it.
    const carriesForward = isCage(s);

    // Tier is the rune's OWN frame colour. Only blue and purple can be that -
    // gold belongs to the cage - so nothing here can return "gold".
    //
    // Note that this is NOT the rune's tier in the game's sense: the frame is
    // per-panel state (the same rune is blue-framed in one capture and plain in
    // another), while the tier is carried by the glyph's ink colour and is
    // fixed per rune shape. Same doc, same section.
    let tier: ClassifiedCell["tier"] = "none";
    let bestContrast = -Infinity;
    for (const band of ["blue", "purple"] as const) {
      if (!isTier(s, band)) continue;
      const contrast = s.profile[band].max - (ambient ? ambient[band] : 0);
      if (contrast > bestContrast) {
        bestContrast = contrast;
        tier = band;
      }
    }

    return { cell: s.cell, profile: s.profile, tier, carriesForward };
  });
}

export interface DetectedRow extends RowBand {
  cells: CellRect[];
}

/**
 * Image -> rows -> cells, in full-image pixel coordinates.
 *
 * `thresholds` enables the gold-column border signal during cell splitting;
 * passing null falls back to dark-lines-only, which is still correct for a row
 * with no caged cells.
 */
export function detectPanel(
  bgraMat: any,
  geometry: PanelGeometry = PANEL_GEOMETRY_DEFAULTS,
  thresholds: TierThresholds | null = null,
): DetectedRow[] {
  const gray = toGrayMat(bgraMat);
  const hsv = toHsvMat(bgraMat);
  try {
    const bands = keepContiguousRowStack(detectRowBands(gray, geometry));
    return bands.map((band) => ({
      ...band,
      cells: detectCellsInRow(gray, hsv, band.top, band.bottom, geometry, thresholds),
    }));
  } finally {
    gray.delete();
    hsv.delete();
  }
}
