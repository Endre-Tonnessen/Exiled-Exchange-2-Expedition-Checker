// Ported from ocr-playground/tests/combo-logic.test.mjs, which is where this
// logic was developed and where every case below first earned its place. Two
// groups were dropped rather than ported: the direct levenshtein tests (this
// version uses the `fastest-levenshtein` dependency the renderer already has,
// so the distance function itself is not ours to test) and the
// normalizeQuantityPrefix tests (that fix lives in main/src/vision/WindowsOcr.ts
// and is applied to the reward text before it ever reaches here).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeComboRowText,
  isFewCharsAway,
  lookupCombination,
  type CombinationTable,
} from "@/web/expedition-check/rune-identity";
import { runeVerdict, resolveRowRunes, moreUrgent } from "@/web/expedition-check/rune-value";

const realTable: CombinationTable = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../public/data/expedition/rune-combinations.json", import.meta.url),
    ),
    "utf8",
  ),
);

describe("normalizeComboRowText", () => {
  it("strips a 'Skill Level N:' prefix and keeps the level", () => {
    expect(normalizeComboRowText("Skill Level 20: Skyfall")).toEqual({
      key: "skyfall",
      level: 20,
      quantity: null,
      cleaned: "Skyfall",
    });
  });

  it("strips a 'Support:' prefix with no level", () => {
    expect(normalizeComboRowText("Support: Healing Runes")).toEqual({
      key: "healingrunes",
      level: null,
      quantity: null,
      cleaned: "Healing Runes",
    });
  });

  it("reads a '(Level N)' suffix (poe2db's own format) instead of a prefix", () => {
    const result = normalizeComboRowText("Skyfall (Level 20)");
    expect(result.level).toBe(20);
    expect(result.key).toBe("skyfall");
  });

  it("punctuation and case never affect the key", () => {
    expect(normalizeComboRowText("Rain of Blades").key).toBe(
      normalizeComboRowText("RAIN-OF-BLADES!!").key,
    );
  });

  it("no colon at all just normalises the whole string", () => {
    expect(normalizeComboRowText("Chaos Orb")).toEqual({
      key: "chaosorb",
      level: null,
      quantity: null,
      cleaned: "Chaos Orb",
    });
  });

  it("parses a leading quantity into its own field, not left in the name", () => {
    expect(normalizeComboRowText("3x Chaos Orb")).toEqual({
      key: "chaosorb",
      level: null,
      quantity: 3,
      cleaned: "Chaos Orb",
    });
    expect(normalizeComboRowText("10x Exalted Orb").quantity).toBe(10);
  });

  it("drops a quantity marker mangled past repair so the name still resolves", () => {
    // Real capture: "1x Warding Rune of Bodyguards" came back as "DIX ...",
    // which WindowsOcr's normalizeQuantityPrefix cannot repair. The count is
    // lost (null) but the name survives, and the name is what identifies the
    // row's runes.
    expect(normalizeComboRowText("DIX Warding Rune of Bodyguards")).toEqual({
      key: "wardingruneofbodyguards",
      level: null,
      quantity: null,
      cleaned: "Warding Rune of Bodyguards",
    });
  });

  it("never mistakes a real name for a garbled quantity marker", () => {
    // "Perfect Chaos Orb" and "Chaos Orb" are DIFFERENT recipes, so dropping a
    // leading word here would resolve to the wrong runes entirely.
    expect(normalizeComboRowText("1x Perfect Chaos Orb").cleaned).toBe("Perfect Chaos Orb");
    expect(normalizeComboRowText("Perfect Chaos Orb").cleaned).toBe("Perfect Chaos Orb");
  });

  it("doesn't throw on empty or undefined input", () => {
    const empty = { key: "", level: null, quantity: null, cleaned: "" };
    expect(normalizeComboRowText("")).toEqual(empty);
    expect(normalizeComboRowText(undefined as unknown as string)).toEqual(empty);
  });
});

describe("isFewCharsAway", () => {
  it("tolerates only 1 edit on a short name (<8 chars)", () => {
    expect(isFewCharsAway("skyfal", "skyfall")).toBe(true); // 1 edit
    expect(isFewCharsAway("skyfl", "skyfall")).toBe(false); // 2 edits
  });

  it("tolerates 2 edits but not 3 on a longer name", () => {
    expect(isFewCharsAway("pr0tect1ve", "protective")).toBe(true); // 2 substitutions
    expect(isFewCharsAway("pr0t3ct1ve", "protective")).toBe(false); // 3
  });
});

describe("lookupCombination - synthetic table (edge cases isolated from real data)", () => {
  const table: CombinationTable = {
    combinations: [
      {
        name: "Skyfall",
        level: 20,
        runes: ["tempest", "celestial", "protective", "ward", "wisdom", "oath"],
      },
      // Same name, different level+shape - level/count must disambiguate.
      { name: "Skyfall", level: 0, runes: ["cold", "sky", "fire"] },
      // Two DIFFERENT combos sharing name+count, disagreeing at index 0.
      { name: "Chaos Orb", level: null, runes: ["fire", "cold"] },
      { name: "Chaos Orb", level: null, runes: ["lightning", "cold"] },
      // Same name+count, but with quantity data (like the real table's
      // "Arcanist's Etcher") - quantity should resolve what count cannot.
      { name: "Ancient Charm", level: null, quantity: 2, runes: ["fire", "cold"] },
      { name: "Ancient Charm", level: null, quantity: 4, runes: ["lightning", "cold"] },
    ],
  };

  it("resolves on exact name + level + count", () => {
    const r = lookupCombination(table, "Skill Level 20: Skyfall", 6, 5);
    expect(r.status).toBe("resolved");
    expect(r.rune).toBe("oath");
  });

  it("disambiguates on cell count alone when no level is stated", () => {
    const r = lookupCombination(table, "Skyfall", 3, 1);
    expect(r.status).toBe("resolved");
    expect(r.rune).toBe("sky");
  });

  it("still resolves through a 1-character OCR typo", () => {
    const r = lookupCombination(table, "Skill Level 20: Skyfa1l", 6, 0); // '1' for 'l'
    expect(r.status).toBe("resolved");
    expect(r.rune).toBe("tempest");
  });

  it("reports ambiguous rather than guessing when candidates disagree at the index", () => {
    const r = lookupCombination(table, "Chaos Orb", 2, 0); // fire vs lightning
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
  });

  it("resolves when candidates disagree elsewhere but AGREE at the index", () => {
    const r = lookupCombination(table, "Chaos Orb", 2, 1); // both 'cold'
    expect(r.status).toBe("resolved");
    expect(r.rune).toBe("cold");
  });

  it("reports no-match rather than throwing on an unknown name", () => {
    expect(lookupCombination(table, "Totally Unknown Reward", 4, 0).status).toBe("no-match");
  });

  it("reports bad-index for an out-of-range cell", () => {
    expect(lookupCombination(table, "Skill Level 20: Skyfall", 6, 9).status).toBe("bad-index");
  });

  it("strips a quantity prefix cleanly rather than leaving it to fuzzy-match luck", () => {
    // Used to be a real sharp edge: an un-stripped "3x " prefix only sometimes
    // survived fuzzy matching by accidental character-count luck. It is parsed
    // into its own field now, so this is an exact name match every time - and
    // this table has no quantity data for "Chaos Orb", so count alone still
    // cannot separate fire from lightning.
    expect(lookupCombination(table, "3x Chaos Orb", 2, 0).status).toBe("ambiguous");
  });

  it("uses quantity to disambiguate what name and count cannot", () => {
    const two = lookupCombination(table, "2x Ancient Charm", 2, 0);
    expect(two.status).toBe("resolved");
    expect(two.rune).toBe("fire");

    const four = lookupCombination(table, "4x Ancient Charm", 2, 0);
    expect(four.status).toBe("resolved");
    expect(four.rune).toBe("lightning");
  });

  it("falls back to the full pool when a quantity matches nothing", () => {
    // 9x does not exist for Ancient Charm. Narrowing to zero candidates would
    // be worse than not narrowing, so both survivors remain and correctly
    // report ambiguous rather than no-match.
    expect(lookupCombination(table, "9x Ancient Charm", 2, 0).status).toBe("ambiguous");
  });
});

describe("lookupCombination - against the real shipped table", () => {
  // Reproduces the first real end-to-end result from ocr-playground's UI:
  // "Skill Level 20: Rain of Blades" resolved to "rage" at cell 5 of 6. Pinned
  // so a change to the matching logic - or a poe2db data refresh - cannot
  // silently break it.
  it("resolves Rain of Blades cell 5 of 6 to rage", () => {
    const r = lookupCombination(realTable, "Skill Level 20: Rain of Blades", 6, 5);
    expect(r.status).toBe("resolved");
    expect(r.rune).toBe("rage");
    expect(r.candidates).toHaveLength(1);
  });

  it("treats the level-0 variant of the same name as 3 cells, not 6", () => {
    const r = lookupCombination(realTable, "Rain of Blades", 3, 0);
    expect(r.status).toBe("resolved");
    expect(r.rune).toBe("arcane");
  });

  it("only ever references rune ids the catalog actually has", () => {
    const known = new Set([
      "adaptive", "arcane", "bait", "bloodletting", "bond", "celestial", "cold",
      "cyclonic", "death", "earth", "electrocuting", "fire", "life", "lightning",
      "momentum", "moon", "oath", "opulent", "power", "prismatic", "protective",
      "rage", "rebirth", "sky", "soul", "stone", "tempest", "tidal", "time",
      "toxic", "vision", "volcanic", "ward", "wisdom",
    ]);
    const unknown = new Set<string>();
    for (const c of realTable.combinations) {
      for (const r of c.runes) if (!known.has(r)) unknown.add(r);
    }
    expect([...unknown]).toEqual([]);
  });

  it("ships real coverage, not a placeholder", () => {
    expect(realTable.combinations.length).toBeGreaterThanOrEqual(200);
  });
});

describe("runeVerdict", () => {
  const ratings = {
    runes: [
      { id: "opulent", rating: "great" as const, why: "rarity on every later encounter" },
      { id: "oath", rating: "trap" as const, why: "extra waves that drop no loot" },
    ],
  };

  it("returns the recorded rating and reason", () => {
    expect(runeVerdict(ratings, "oath")).toEqual({
      rating: "trap",
      why: "extra waves that drop no loot",
    });
  });

  it("reports unrated - never neutral - for a rune with no entry", () => {
    // The distinction matters: neutral is a claim that the rune is harmless,
    // unrated means nobody has judged it. Defaulting to neutral would quietly
    // imply a recommendation nobody made.
    expect(runeVerdict(ratings, "bond")).toEqual({ rating: "unrated", why: null });
  });

  it("reports unrated for an unidentified rune or a missing ratings file", () => {
    expect(runeVerdict(ratings, null).rating).toBe("unrated");
    expect(runeVerdict(null, "opulent").rating).toBe("unrated");
  });

  it("ranks a trap as more urgent than a great rune", () => {
    // A trap you are about to take matters more than a good rune you might miss.
    expect(moreUrgent("trap", "great")).toBe(true);
    expect(moreUrgent("unrated", "poor")).toBe(false);
  });
});

describe("resolveRowRunes", () => {
  const table: CombinationTable = {
    combinations: [
      { name: "Skyfall", level: 20, runes: ["opulent", "oath", "sky"] },
    ],
  };
  const ratings = {
    runes: [
      { id: "opulent", rating: "great" as const, why: "rarity" },
      { id: "oath", rating: "trap" as const, why: "no loot" },
    ],
  };

  it("names every cell in the row and carries the cage flag through", () => {
    const runes = resolveRowRunes(table, ratings, "Skill Level 20: Skyfall", [
      { carriesForward: false, tier: "gold" },
      { carriesForward: true, tier: "none" },
      { carriesForward: false, tier: "blue" },
    ]);
    expect(runes.map((r) => r.runeId)).toEqual(["opulent", "oath", "sky"]);
    expect(runes.map((r) => r.rating)).toEqual(["great", "trap", "unrated"]);
    expect(runes.find((r) => r.carriesForward)?.runeId).toBe("oath");
    // Tier and cage are independent layers and must not overwrite each other:
    // cell 0 is gold-tiered but NOT caged, cell 1 is caged with no tier colour.
    expect(runes[0].tier).toBe("gold");
    expect(runes[0].carriesForward).toBe(false);
    expect(runes[1].tier).toBe("none");
  });

  it("returns a slot per cell even when the reward text resolves to nothing", () => {
    // A row still shows N runes on screen; listing fewer would read as a bug.
    const runes = resolveRowRunes(table, ratings, "3x Chaos Orb", [
      { carriesForward: false, tier: "none" },
      { carriesForward: true, tier: "none" },
    ]);
    expect(runes).toHaveLength(2);
    expect(runes.every((r) => r.runeId === null)).toBe(true);
    expect(runes.every((r) => r.rating === "unrated")).toBe(true);
  });
});
