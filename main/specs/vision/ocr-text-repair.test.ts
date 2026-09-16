// Ported from ocr-playground/tests/combo-logic.test.mjs's `normalizeQuantityPrefix`
// group, which was dropped rather than ported when this logic moved into the fork -
// the note at the top of renderer/specs/expedition-check/rune-identity.test.ts says
// the fix "lives in main/src/vision/WindowsOcr.ts", which was true and left it with
// no tests anywhere. These are those tests, restored.

import { describe, it, expect } from "vitest";
// Relative, not aliased: `main` has no path alias configured (unlike the
// renderer's "@/"), and adding one would mean editing main/tsconfig.json.
import { normalizeQuantityPrefix } from "../../src/vision/ocr-text-repair";

describe("normalizeQuantityPrefix", () => {
  it("fixes a lone 'I' misread as the digit 1", () => {
    expect(normalizeQuantityPrefix("IX Greater Jeweller's Orb")).toBe(
      "1x Greater Jeweller's Orb",
    );
  });

  it("fixes a mixed 'IO' misread as the digits 10", () => {
    expect(normalizeQuantityPrefix("IOX Chaos Orb")).toBe("10x Chaos Orb");
  });

  it("leaves a correctly-read digit prefix untouched", () => {
    expect(normalizeQuantityPrefix("3x Divine Orb")).toBe("3x Divine Orb");
  });

  // The reason the regex is anchored and not a global I->1 / O->0 replace. Getting
  // this wrong turns "Orb" into "0rb" on every single row, which then fails to
  // price-match at all.
  it("never touches I/O elsewhere in the line", () => {
    expect(normalizeQuantityPrefix("1x Orb of Insight")).toBe("1x Orb of Insight");
    expect(normalizeQuantityPrefix("Orb of Insight")).toBe("Orb of Insight");
  });

  // The playground applied this per line of a multi-line block; WindowsOcr.ts calls
  // it once per OCR line instead, so the anchor must genuinely mean "start of this
  // line" and a stray embedded newline must not let a second prefix through.
  it("only repairs the leading token, not one after a newline", () => {
    expect(normalizeQuantityPrefix("IX Chaos Orb\nIOX Exalted Orb")).toBe(
      "1x Chaos Orb\nIOX Exalted Orb",
    );
  });

  // "DIX Warding Rune of Bodyguards" is a real capture: the marker is mangled past
  // repair. This must leave it alone rather than inventing a quantity - the
  // renderer's normalizeComboRowText then drops the token and keeps the name.
  it("leaves a marker it cannot repair alone", () => {
    expect(normalizeQuantityPrefix("DIX Warding Rune of Bodyguards")).toBe(
      "DIX Warding Rune of Bodyguards",
    );
  });

  it("does not throw on empty input", () => {
    expect(normalizeQuantityPrefix("")).toBe("");
  });
});
