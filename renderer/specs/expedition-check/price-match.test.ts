import { describe, it, expect } from "vitest";
import { normalize } from "@/web/expedition-check/parsing";
import {
  buildPriceIndex,
  resolvePrice,
  type FlatPriceEntry,
} from "@/web/expedition-check/price-match";

const SAMPLE_ENTRIES: FlatPriceEntry[] = [
  { name: "Gemcutter's Prism", primaryValue: 0.5, detailsId: "gemcutters-prism" },
  { name: "Glassblower's Bauble", primaryValue: 0.02, detailsId: "glassblowers-bauble" },
  { name: "Farrul's Rune of Grace", primaryValue: 1, detailsId: "farruls-rune-of-grace" },
  {
    name: "Farrul's Rune of the Hunt",
    primaryValue: 2,
    detailsId: "farruls-rune-of-the-hunt",
  },
  { name: "Regal Orb", primaryValue: 0.003676, detailsId: "regal-orb" },
  { name: "Exalted Orb", primaryValue: 0.001324, detailsId: "exalted-orb" },
  {
    name: "Uncut Skill Gem (Level 12)",
    primaryValue: 0.31,
    detailsId: "uncut-skill-gem-12",
  },
];

const index = buildPriceIndex(SAMPLE_ENTRIES);

describe("resolvePrice", () => {
  it("resolves an exact match", () => {
    const result = resolvePrice(normalize("Regal Orb"), index);
    expect(result?.entry.detailsId).toBe("regal-orb");
    expect(result?.exact).toBe(true);
  });

  it("resolves the gem key format produced by resolveGemKey", () => {
    const result = resolvePrice("uncut skill gem level 12", index);
    expect(result?.entry.detailsId).toBe("uncut-skill-gem-12");
  });

  // These three are the exact OCR misreads recovered in the live spike against the
  // 4-row and 9-row example screenshots - single-character substitutions that fuzzy
  // matching is specifically there to correct.
  it("fixes a single-character OCR substitution (Gemcutter's -> Gemeutter's)", () => {
    const result = resolvePrice(normalize("Gemeutter's Prism"), index);
    expect(result?.entry.detailsId).toBe("gemcutters-prism");
    expect(result?.exact).toBe(true); // high-confidence, single-char diff
  });

  it("fixes a single-character OCR substitution (Bauble -> Hauble)", () => {
    const result = resolvePrice(normalize("Glassblower's Hauble"), index);
    expect(result?.entry.detailsId).toBe("glassblowers-bauble");
  });

  it("fixes a single-character OCR substitution (Farrul's -> Farvul's)", () => {
    const result = resolvePrice(normalize("Farvul's Rune of the Hunt"), index);
    expect(result?.entry.detailsId).toBe("farruls-rune-of-the-hunt");
  });

  it("does not confuse two similarly-worded items despite single-char typos in each", () => {
    // "Farrul's Rune of Grace" vs "...of the Hunt" differ enough that a bad OCR read
    // of one must not resolve to the other, even with a minor typo in each.
    const result = resolvePrice(normalize("Farrul's Rune of Grece"), index);
    expect(result?.entry.detailsId).toBe("farruls-rune-of-grace");
    const other = resolvePrice(normalize("Farrul's Rune of tha Hunt"), index);
    expect(other?.entry.detailsId).toBe("farruls-rune-of-the-hunt");
  });

  it("rejects a fuzzy match that's too different (dropped a whole word, not a typo)", () => {
    // "Rune of Huntt" vs "Rune of the Hunt" is missing "the" entirely - a bigger edit
    // than a realistic OCR misread, and must fall below the fuzzy threshold rather
    // than guessing.
    const result = resolvePrice(normalize("Farrul's Rune of Huntt"), index);
    expect(result).toBeNull();
  });

  // Real finding from the spike: "Expansive Alloy" was read correctly by OCR but
  // genuinely isn't tracked by the price feed. Must return null, never a guess.
  it("returns null for a name that isn't in the price data at all", () => {
    const result = resolvePrice(normalize("Expansive Alloy"), index);
    expect(result).toBeNull();
  });

  it("returns null for unrelated short garbage", () => {
    const result = resolvePrice(normalize("xz"), index);
    expect(result).toBeNull();
  });
});
