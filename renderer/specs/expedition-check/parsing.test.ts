import { describe, it, expect } from "vitest";
import {
  normalize,
  parseLine,
  resolveGemKey,
  looksLikeGemReward,
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

// The panel-open discriminator. Every line below is real OCR output, produced by
// running main's own Windows OCR bridge over the nine panel captures in
// ocr-playground/fixtures - not invented for the test. That run is the evidence
// the rule rests on: across all nine, every reward row carries one of the two
// markers, and the only lines that don't are the ones noted in the second block.
describe("looksLikeGemReward", () => {
  it("accepts the colon-prefixed reward forms, which carry no quantity", () => {
    for (const line of [
      "Skill Level 20: Rain of Blades",
      "Skill Level 20: Wardbound Minions",
      "Skill Level 20: Explosive Transmutation",
      "Support: Healing Runes",
      "Spirit Level 14: Grim Feast",
    ]) {
      expect(looksLikeGemReward(line), line).toBe(true);
    }
  });

  // The whole point: stray world text that drifts into the capture region parses
  // perfectly well as a nameless, priceless row, so parseLine() alone cannot be
  // used as evidence that the panel is open. A chest label was what actually
  // surfaced this - it appeared as a "?" row just after the panel closed.
  it("rejects stray world text and the panel's own furniture", () => {
    for (const line of [
      "Overgrown Clam",
      "Runeshape",
      "Saqawal's Rune of Memory",
      "Vaal Vessel",
      "",
    ]) {
      expect(looksLikeGemReward(line), line).toBe(false);
    }
  });

  // A reward row with a quantity is caught by parseLine's explicitQuantity
  // instead - this function only has to cover the rows that have no quantity at
  // all, so it is not expected (or required) to match these.
  it("leaves quantity-prefixed rows to explicitQuantity", () => {
    expect(parseLine("3x Divine Orb")?.explicitQuantity).toBe(true);
    expect(parseLine("1x Warding Rune of Hollowing")?.explicitQuantity).toBe(true);
    expect(parseLine("10x Chaos Orb")?.explicitQuantity).toBe(true);
    // ...and stray text has neither marker, which is what makes it rejectable.
    expect(parseLine("Overgrown Clam")?.explicitQuantity).toBe(false);
    expect(looksLikeGemReward("Overgrown Clam")).toBe(false);
  });
});
