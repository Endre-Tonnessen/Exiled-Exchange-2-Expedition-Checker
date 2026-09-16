// keepContiguousRowStack is the one piece of the detector that is pure data in,
// data out - no Mat, no OpenCV, no fixture image - so it gets ordinary unit tests
// that run everywhere, unlike the pixel suite next door.
//
// The numbers below are not invented. The function's own doc comment records what
// was measured on real full-panel captures: consecutive reward rows sit exactly
// 4px apart (they share a bar border), while the panel furniture it exists to
// discard sat 17px, 158px and 224px away. Each test names which of those it is.

import { describe, it, expect } from "vitest";
import {
  keepContiguousRowStack,
  type RowBand,
} from "../../../src/vision/expedition-runes/panel-detector";

/** Builds `count` bands of `height`px, each `gap`px below the previous, starting at `top`. */
function stack(top: number, count: number, height: number, gap = 4): RowBand[] {
  const bands: RowBand[] = [];
  let y = top;
  for (let i = 0; i < count; i++) {
    bands.push({ top: y, bottom: y + height });
    y += height + gap;
  }
  return bands;
}

describe("keepContiguousRowStack", () => {
  it("returns a single band untouched", () => {
    const one = [{ top: 10, bottom: 70 }];
    expect(keepContiguousRowStack(one)).toEqual(one);
  });

  it("returns an empty list untouched", () => {
    expect(keepContiguousRowStack([])).toEqual([]);
  });

  it("keeps a clean 5-row stack whole", () => {
    // The full_uncropped_5rows case: five real rows, nothing else in the capture.
    const bands = stack(20, 5, 60);
    expect(keepContiguousRowStack(bands)).toEqual(bands);
  });

  it("drops the title bar above the list", () => {
    // 158px is one of the real measured furniture gaps.
    const title: RowBand = { top: 0, bottom: 40 };
    const rows = stack(198, 3, 60);
    expect(keepContiguousRowStack([title, ...rows])).toEqual(rows);
  });

  it("drops the decorative area below the list", () => {
    const rows = stack(20, 4, 60);
    const decoration: RowBand = { top: 300, bottom: 360 };
    expect(keepContiguousRowStack([...rows, decoration])).toEqual(rows);
  });

  it("drops furniture on both sides at once", () => {
    const title: RowBand = { top: 0, bottom: 40 };
    const rows = stack(264, 3, 60);
    const decoration: RowBand = { top: 700, bottom: 760 };
    expect(keepContiguousRowStack([title, ...rows, decoration])).toEqual(rows);
  });

  it("treats the measured 4px row gap as contiguous and a 17px gap as a break", () => {
    // 4px and 17px are the two real measurements the threshold sits between; this
    // is the test that fails first if maxGap is ever retuned past either of them.
    const contiguous = stack(20, 3, 60, 4);
    expect(keepContiguousRowStack(contiguous)).toHaveLength(3);

    const broken: RowBand[] = [
      { top: 20, bottom: 80 },
      { top: 97, bottom: 157 }, // 17px gap - furniture, not the next row
    ];
    expect(keepContiguousRowStack(broken)).toHaveLength(1);
  });

  it("keeps the longer run when two runs compete", () => {
    const short = stack(0, 2, 60);
    const long = stack(400, 5, 60);
    expect(keepContiguousRowStack([...short, ...long])).toEqual(long);
  });

  it("keeps the topmost run when two runs tie on length", () => {
    // Documented behaviour ("ties keep the topmost run"), and the safer default:
    // the reward list is drawn above the decorative area, never below it.
    const first = stack(0, 3, 60);
    const second = stack(400, 3, 60);
    expect(keepContiguousRowStack([...first, ...second])).toEqual(first);
  });

  it("scales its gap tolerance with row height rather than using a fixed pixel budget", () => {
    // A 4K capture's rows are proportionally taller AND further apart; a fixed
    // budget would split every such panel into single-row runs.
    const tall = stack(0, 4, 240, 30); // 30px gaps, but 240px rows
    expect(keepContiguousRowStack(tall)).toHaveLength(4);
  });
});
