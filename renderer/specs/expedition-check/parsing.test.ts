import { describe, it, expect } from "vitest";
import {
  normalize,
  parseLine,
  resolveGemKey,
} from "@/web/expedition-check/parsing";

describe("normalize", () => {
  it("lowercases, strips punctuation to spaces, collapses whitespace", () => {
    expect(normalize("Olroth's  Saga")).toBe("olroth s saga");
  });
});

describe("parseLine", () => {
  // These are the exact rows read back correctly in the live OCR spike against the
  // user's real Runeshape Combinations screenshots.
  it("parses an explicit quantity", () => {
    expect(parseLine("1x Expansive Alloy")).toEqual({
      quantity: 1,
      name: "expansive alloy",
      explicitQuantity: true,
    });
  });

  it("parses a larger explicit quantity", () => {
    expect(parseLine("3x Regal Orb")).toEqual({
      quantity: 3,
      name: "regal orb",
      explicitQuantity: true,
    });
  });

  it("handles an apostrophe in the item name", () => {
    expect(parseLine("2x Glassblower's Bauble")).toEqual({
      quantity: 2,
      name: "glassblower s bauble",
      explicitQuantity: true,
    });
  });

  // Real edge case from the 9-row example: "Uncut Spirit Gem" has no leading "Nx" at
  // all - absence of a quantity prefix means quantity 1, not a parse failure.
  it("defaults to quantity 1 when no 'Nx' prefix is present", () => {
    expect(parseLine("Uncut Spirit Gem")).toEqual({
      quantity: 1,
      name: "uncut spirit gem",
      explicitQuantity: false,
    });
  });

  it("rejects lines that are too short to be a real row (panel chrome/border noise)", () => {
    expect(parseLine("R")).toBeNull();
    expect(parseLine("| |")).toBeNull();
    expect(parseLine("")).toBeNull();
  });

  it("rejects the panel's own title line", () => {
    expect(parseLine("Runeshape Combinations")).toBeNull();
  });
});

describe("resolveGemKey", () => {
  it("is a no-op for rows that aren't about gems", () => {
    expect(resolveGemKey("regal orb")).toEqual({ isGemRow: false });
  });

  it("is a no-op when 'gem' appears without a recognizable type", () => {
    expect(resolveGemKey("some random gem thing")).toEqual({
      isGemRow: false,
    });
  });

  it("builds a level-specific key when the level is readable", () => {
    expect(resolveGemKey("uncut skill gem level 12")).toEqual({
      isGemRow: true,
      key: "uncut skill gem level 12",
    });
    expect(resolveGemKey("uncut spirit gem level 18")).toEqual({
      isGemRow: true,
      key: "uncut spirit gem level 18",
    });
  });

  // Safety-critical case: adjacent gem levels can differ several-fold in price, so an
  // unreadable level must never fall through to a fuzzy/guessed price.
  it("refuses to guess when the level can't be read", () => {
    expect(resolveGemKey("uncut spirit gem")).toEqual({
      isGemRow: true,
      key: null,
    });
  });
});
