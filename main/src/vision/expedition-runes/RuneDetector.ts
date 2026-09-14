// Entry point for the rune layer: a screenshot and a calibrated region in,
// per-row cell geometry and border classification out.
//
// Deliberately knows NOTHING about reward text, recipes, prices or ratings.
// Naming a rune happens in the renderer (rune-identity.ts), which already has
// the OCR text and needs no pixels. Splitting it that way is what keeps the two
// layers independent: this one never has to wait for OCR to finish, and OCR
// never has to wait for this. See EXPEDITION_RUNE_PORT_PLAN.md.
//
// Runs inside the vision worker thread (link-worker.ts), unlike the Windows OCR
// call which is a subprocess spawned from the main thread. That is the other
// half of the independence: the two genuinely run in parallel, so turning this
// on cannot slow the reward pricing down.

// `cv` is a live binding - wasm-bindings assigns it asynchronously in init(),
// and every use below happens well after that, so importing it at module load
// is safe as long as nothing dereferences it at load time.
import { cv, cvMatFromImage } from "../wasm-bindings";
import { cropImageFraction, type FractionRect, type ImageData } from "../utils";
import {
  detectPanel,
  classifyRowCells,
  DEFAULT_TIER_THRESHOLDS,
  PANEL_GEOMETRY_DEFAULTS,
  type CellRect,
} from "./panel-detector";

/** One rune cell, as the renderer receives it. Geometry is in fractions of the captured region, never pixels, so the overlay can position without knowing the capture size. */
export interface RuneCellResult {
  index: number;
  /** left edge, fraction (0-1) of the region's width */
  x: number;
  /** width, fraction (0-1) of the region's width */
  width: number;
  /** top edge, fraction (0-1) of the region's height */
  y: number;
  /** height, fraction (0-1) of the region's height */
  height: number;
  /** the rune's own frame colour - independent of the cage */
  tier: "none" | "gold" | "purple" | "blue";
  /** this slot propagates its rune to every later encounter in the chain */
  carriesForward: boolean;
}

export interface RuneRowResult {
  /** top of the row band, fraction (0-1) of the region's height */
  y: number;
  /** height of the row band, fraction (0-1) of the region's height */
  height: number;
  cells: RuneCellResult[];
}

export interface RuneDetectionResult {
  elapsed: number;
  rows: RuneRowResult[];
  /** set only when no rows were found, to explain why rather than just reporting nothing */
  diagnostic?: string;
}

/**
 * Detects rune rows and cells in the calibrated region of a screenshot.
 *
 * Never throws for image reasons: a bad frame, a stale region or a panel that
 * is not open should come back as zero rows, not an exception - this runs on a
 * poll timer for as long as the overlay is up.
 */
export function detectExpeditionRunes(
  screenshot: ImageData,
  rect: FractionRect,
): RuneDetectionResult {
  const start = performance.now();
  const cropped = cropImageFraction(screenshot, rect);
  if (cropped.width < 8 || cropped.height < 8) {
    return { elapsed: performance.now() - start, rows: [], diagnostic: "Capture region is too small to analyse." };
  }

  // BGRA, straight from the native screenshot - every hue threshold downstream
  // assumes that byte order. See rune-vision.ts's channel-order note.
  const bgra = cvMatFromImage(cropped);
  try {
    const detected = detectPanel(bgra, PANEL_GEOMETRY_DEFAULTS, DEFAULT_TIER_THRESHOLDS);
    if (detected.length === 0) {
      return {
        elapsed: performance.now() - start,
        rows: [],
        diagnostic:
          `No reward rows found in a ${cropped.width}x${cropped.height}px region. ` +
          `If the Combinations panel is open, the calibrated region probably does not line up with it.`,
      };
    }

    const rows: RuneRowResult[] = detected.map((row) => {
      const classified =
        row.cells.length > 0
          ? classifyRowCells(
              (cell: CellRect) => bgra.roi(new cv.Rect(cell.x, cell.y, cell.w, cell.h)).clone(),
              row.cells,
              DEFAULT_TIER_THRESHOLDS,
            )
          : [];

      return {
        y: row.top / cropped.height,
        height: (row.bottom - row.top) / cropped.height,
        cells: classified.map((c, index) => ({
          index,
          x: c.cell.x / cropped.width,
          width: c.cell.w / cropped.width,
          y: c.cell.y / cropped.height,
          height: c.cell.h / cropped.height,
          tier: c.tier,
          carriesForward: c.carriesForward,
        })),
      };
    });

    return { elapsed: performance.now() - start, rows };
  } finally {
    bgra.delete();
  }
}
