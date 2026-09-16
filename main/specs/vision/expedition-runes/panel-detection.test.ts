// The detector, run over real panel captures and graded against hand-dictated
// ground truth.
//
// THIS SUITE MEASURES, IT DOES NOT GATE. Rune border detection reads a few
// pixels of a stylised in-game frame; it is genuinely brittle, and some cells
// will be wrong at any given moment. A cell it gets wrong is a number to watch,
// not a broken build. So every fixture is graded into a scorecard and compared
// against `specs/fixtures/baseline.json` - the accuracy this code is known to
// have reached. A run fails only when a number goes DOWN. Numbers going up print
// a note telling you to re-record the baseline.
//
//   npx vitest run specs/vision/expedition-runes/panel-detection.test.ts
//   UPDATE_RUNE_BASELINE=1 npx vitest run ...   # re-record after an improvement
//
// Grading rules, carried over from ocr-playground/tests/panel-pipeline.browser-test.mjs:
//   - Rows and cells line up BY INDEX. A count mismatch is reported as its own
//     number and the rows that do line up are still graded, because partial
//     signal is what you want while iterating.
//   - Only what the dictation actually says is graded. A cell whose border
//     colour was never named has no `tier` key and is skipped for that check -
//     five of the 95 cells are in that state (all of them caged), and filling
//     them in from what the detector currently reports would make this file
//     agree with the code by construction and measure nothing.
//   - `runeId` is NOT graded here. Identity is resolved in the renderer from the
//     reward text, never from pixels (see EXPEDITION_RUNE_PORT_PLAN.md); it is
//     kept in the fixtures for the renderer-side tests.

import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import { findCvBinDir } from "../../support/cv";
import {
  loadAllGroundTruth,
  loadFixtureImage,
  FIXTURES_DIR,
  type GroundTruth,
} from "../../support/fixtures";

// Substitutes the REAL OpenCV build for the module that normally holds it.
//
// wasm-bindings.ts assigns `cv` inside `init()`, which loads opencv.js with
// `await import()` - a call that only works because esbuild rewrites it to
// `require()` when it bundles the worker (see specs/support/cv.ts). Rather than
// change production code to suit a test, the binding module is replaced here
// with one holding a genuinely-loaded cv. What is NOT exercised by this is
// `init()` itself, which is four lines of glue; everything below it is the real
// thing, running the real OpenCV, on real pixels.
vi.mock("../../../src/vision/wasm-bindings", async () => {
  const { findCvBinDir, loadRealCv } = await import("../../support/cv");
  const dir = findCvBinDir();
  const cv = dir ? await loadRealCv(dir) : null;
  return {
    cv,
    // Same four lines as the real one, which cannot be reused: it closes over
    // the `cv` of the module being replaced, which nothing ever assigns here.
    cvMatFromImage: (img: { width: number; height: number; data: Uint8Array }) => {
      const mat = new cv.Mat(img.height, img.width, cv.CV_8UC4);
      mat.data.set(img.data);
      return mat;
    },
    tessApi: null,
    init: async () => {},
    changeLanguage: async () => {},
    ocrSetImage: () => {},
  };
});

const { detectExpeditionRunes } = await import(
  "../../../src/vision/expedition-runes/RuneDetector"
);

const BASELINE_PATH = path.join(FIXTURES_DIR, "baseline.json");
const UPDATING = process.env.UPDATE_RUNE_BASELINE === "1";

interface Scorecard {
  /** rows the detector found vs rows the ground truth says are there */
  rowsDetected: number;
  rowsExpected: number;
  /** rows (of those that line up) whose cell count is exactly right */
  cellCountExact: number;
  /** cells graded for border colour, and how many matched */
  tierCorrect: number;
  tierGraded: number;
  /** every cell that lines up is graded for the succession cage */
  cageCorrect: number;
  cageGraded: number;
}

type Baseline = Record<string, Omit<Scorecard, "rowsExpected" | "tierGraded" | "cageGraded">>;

const binDir = findCvBinDir();
const fixtures = loadAllGroundTruth();
const results = new Map<string, Scorecard>();

function grade(truth: GroundTruth, detected: ReturnType<typeof detectExpeditionRunes>): Scorecard {
  const score: Scorecard = {
    rowsDetected: detected.rows.length,
    rowsExpected: truth.rows.length,
    cellCountExact: 0,
    tierCorrect: 0,
    tierGraded: 0,
    cageCorrect: 0,
    cageGraded: 0,
  };

  const rowN = Math.min(detected.rows.length, truth.rows.length);
  for (let r = 0; r < rowN; r++) {
    const got = detected.rows[r];
    const want = truth.rows[r];
    if (got.cells.length === want.cells.length) score.cellCountExact++;

    const cellN = Math.min(got.cells.length, want.cells.length);
    for (let c = 0; c < cellN; c++) {
      if (want.cells[c].tier !== undefined) {
        score.tierGraded++;
        if (got.cells[c].tier === want.cells[c].tier) score.tierCorrect++;
      }
      score.cageGraded++;
      if (got.cells[c].carriesForward === want.cells[c].carriesForward) score.cageCorrect++;
    }
  }
  return score;
}

function loadBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

const baseline = loadBaseline();

describe.skipIf(binDir === null)("expedition rune detection against real captures", () => {
  it("has fixtures to grade", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const { name, data } of fixtures) {
    it(`detects ${name}`, () => {
      const image = loadFixtureImage(data.image);
      const rect = data.region ?? { x: 0, y: 0, width: 1, height: 1 };

      const detected = detectExpeditionRunes(image, rect);
      const score = grade(data, detected);
      results.set(name, score);

      if (UPDATING) return;

      const prev = baseline[name];
      if (!prev) {
        // No recorded baseline for this fixture yet - a brand new capture. Report
        // its numbers but do not invent a bar for it to clear.
        console.log(
          `  ${name}: no baseline yet - rows ${score.rowsDetected}/${score.rowsExpected}, ` +
            `cell counts ${score.cellCountExact}/${score.rowsExpected}, ` +
            `tier ${score.tierCorrect}/${score.tierGraded}, cage ${score.cageCorrect}/${score.cageGraded}`,
        );
        return;
      }

      // Soft, so one fixture reports every metric that moved, not just the first.
      expect
        .soft(score.rowsDetected, `${name}: rows detected (expected ${score.rowsExpected})`)
        .toBeGreaterThanOrEqual(prev.rowsDetected);
      expect
        .soft(score.cellCountExact, `${name}: rows with an exact cell count`)
        .toBeGreaterThanOrEqual(prev.cellCountExact);
      expect
        .soft(score.tierCorrect, `${name}: correct border colours (of ${score.tierGraded} graded)`)
        .toBeGreaterThanOrEqual(prev.tierCorrect);
      expect
        .soft(score.cageCorrect, `${name}: correct succession cages (of ${score.cageGraded} graded)`)
        .toBeGreaterThanOrEqual(prev.cageCorrect);
    });
  }

  // Never throws for image reasons, whatever it is handed - this runs on a poll
  // timer while the overlay is up, so an exception here would be a crash loop.
  it("returns a diagnostic rather than throwing on a region too small to analyse", () => {
    const image = loadFixtureImage(fixtures[0].data.image);
    const result = detectExpeditionRunes(image, { x: 0, y: 0, width: 0.001, height: 0.001 });
    expect(result.rows).toEqual([]);
    expect(result.diagnostic).toBeTruthy();
  });

  it("returns a diagnostic rather than throwing on a region with no panel in it", () => {
    // A solid-grey frame: the right size, nothing to find.
    const blank = {
      width: 400,
      height: 300,
      data: new Uint8Array(400 * 300 * 4).fill(128),
    };
    const result = detectExpeditionRunes(blank, { x: 0, y: 0, width: 1, height: 1 });
    expect(result.rows).toEqual([]);
    expect(result.diagnostic).toBeTruthy();
  });

  afterAll(() => {
    if (results.size === 0) return;

    const total = { rows: 0, rowsExp: 0, cellExact: 0, tierOk: 0, tierN: 0, cageOk: 0, cageN: 0 };
    const lines: string[] = [];
    for (const [name, s] of results) {
      total.rows += s.rowsDetected;
      total.rowsExp += s.rowsExpected;
      total.cellExact += s.cellCountExact;
      total.tierOk += s.tierCorrect;
      total.tierN += s.tierGraded;
      total.cageOk += s.cageCorrect;
      total.cageN += s.cageGraded;
      lines.push(
        `  ${name.padEnd(52)} rows ${s.rowsDetected}/${s.rowsExpected}  ` +
          `cellcount ${s.cellCountExact}/${s.rowsExpected}  ` +
          `tier ${s.tierCorrect}/${s.tierGraded}  cage ${s.cageCorrect}/${s.cageGraded}`,
      );
    }
    const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
    console.log(
      `\nRune detection accuracy over ${results.size} captures\n` +
        lines.join("\n") +
        `\n  ${"TOTAL".padEnd(52)} rows ${total.rows}/${total.rowsExp}  ` +
        `cellcount ${total.cellExact}/${total.rowsExp}  ` +
        `tier ${total.tierOk}/${total.tierN} (${pct(total.tierOk, total.tierN)})  ` +
        `cage ${total.cageOk}/${total.cageN} (${pct(total.cageOk, total.cageN)})\n`,
    );

    if (UPDATING) {
      const next: Baseline = {};
      for (const [name, s] of results) {
        next[name] = {
          rowsDetected: s.rowsDetected,
          cellCountExact: s.cellCountExact,
          tierCorrect: s.tierCorrect,
          cageCorrect: s.cageCorrect,
        };
      }
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
      console.log(`Re-recorded baseline: ${BASELINE_PATH}`);
    }
  });
});

if (binDir === null) {
  describe("expedition rune detection", () => {
    it.skip("skipped: no OpenCV build found - run the app once, or set EE2_CV_BIN_DIR", () => {});
  });
}
