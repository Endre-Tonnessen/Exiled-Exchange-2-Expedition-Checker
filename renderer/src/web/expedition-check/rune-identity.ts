// Naming the rune in a given cell of a Combinations row, from the reward text
// alone - no image work at all.
//
// The trick this file exists for: the panel never names the runes it shows, but
// the reward it grants is the name of a specific recipe, and each recipe has a
// FIXED rune order. So "Skill Level 20: Skyfall" plus "the 3rd cell is the caged
// one" identifies that rune exactly - a plain string lookup against a scraped
// table, reusing reward text this widget already OCRs for pricing. No new
// capture region, no sprite library, no per-pixel matching.
//
// Why this and not image matching: measured over three full-panel fixtures in
// ocr-playground (52 labelled cells), name+position resolved 37 correctly while
// a dHash perceptual match managed 3. These glyphs are thin line art about 30px
// across, and reducing that to a 9x8 hash grid does not survive a 1px shift -
// crops of the SAME rune from the SAME image hashed 26-37 bits apart. So the
// table leads; pixels are not currently used for identity at all.
//
// It does not cover every row. A generic currency reward ("3x Chaos Orb") is
// produced by many different recipes, so the lookup stays unresolved - and
// reports that explicitly rather than guessing. A wrong rune label is worse than
// an absent one, because it actively misleads a pick.
//
// Ported from ocr-playground/combo-logic.js. It lives in the renderer rather
// than in main/src/vision deliberately: it needs the OCR text, which the
// renderer already receives, and it needs no pixels. Keeping it here means the
// vision layer never has to wait for OCR, so the two layers stay independent -
// see EXPEDITION_RUNE_PORT_PLAN.md.

import { distance } from "fastest-levenshtein";

export interface Combination {
  name: string;
  level: number | null;
  quantity?: number;
  runes: string[];
}

export interface CombinationTable {
  combinations: Combination[];
}

export interface NormalizedRowText {
  /** lowercased, punctuation-stripped - the actual match key */
  key: string;
  level: number | null;
  quantity: number | null;
  /** human-readable remainder, for display and debugging */
  cleaned: string;
}

/**
 * "Skill Level 20: Skyfall"  -> { key: "skyfall",      level: 20,   quantity: null, cleaned: "Skyfall" }
 * "Support: Healing Runes"   -> { key: "healingrunes", level: null, quantity: null, cleaned: "Healing Runes" }
 * "3x Chaos Orb"             -> { key: "chaosorb",     level: null, quantity: 3,    cleaned: "Chaos Orb" }
 *
 * Deliberately NOT reusing parsing.ts's `normalize`: that one is tuned to
 * produce a good *price-lookup* key and strips aggressively (leading noise
 * tokens, trailing stack counts). Here the level and quantity are needed as
 * separate fields, because both narrow which recipe a row is.
 */
export function normalizeComboRowText(raw: string): NormalizedRowText {
  const s0 = raw || "";
  const colonIdx = s0.lastIndexOf(":");
  const prefix = colonIdx !== -1 ? s0.slice(0, colonIdx) : "";
  let rest = colonIdx !== -1 ? s0.slice(colonIdx + 1) : s0;

  let level: number | null = null;
  const suffixMatch = rest.match(/\(Level\s*(\d+)\)/i);
  if (suffixMatch) {
    level = Number(suffixMatch[1]);
    rest = rest.replace(suffixMatch[0], "");
  }
  const prefixMatch = prefix.match(/Level\s*(\d+)/i);
  if (level === null && prefixMatch) level = Number(prefixMatch[1]);

  // Currency/item rewards carry a leading quantity ("3x Chaos Orb", never a
  // colon-prefixed skill/support row) - strip it into its own field rather than
  // leaving it entangled in the fuzzy-matched name. By the time real OCR text
  // reaches here it has already been through WindowsOcr.ts's
  // normalizeQuantityPrefix, so this normally sees clean digits rather than the
  // "IX"/"IOX" misreads.
  let quantity: number | null = null;
  const qtyMatch = rest.match(/^\s*(\d+)x\s+/i);
  if (qtyMatch) {
    quantity = Number(qtyMatch[1]);
    rest = rest.slice(qtyMatch[0].length);
  } else {
    // Sometimes the quantity marker comes back mangled past repair - "DIX
    // Warding Rune of Bodyguards" for "1x ...", observed on a real capture.
    // Losing the count is survivable (it only ever narrows a lookup), but
    // letting the wreckage stay glued to the front loses the NAME too, and the
    // name is what identifies every rune in the row. So drop a leading token
    // that can only be a quantity marker: at most three digit-lookalike
    // characters followed by an x. Deliberately narrow - a real reward name has
    // never started that way, whereas dropping any short first token would turn
    // "Perfect Chaos Orb" into the genuinely different "Chaos Orb" recipe.
    const garbled = rest.match(/^\s*[0-9IOlD|Q]{1,3}[xX]\s+/);
    if (garbled) rest = rest.slice(garbled[0].length);
  }

  const cleaned = rest.trim();
  const key = cleaned.toLowerCase().replace(/[^a-z0-9]/g, "");
  return { key, level, quantity, cleaned };
}

/** 1 edit under 8 chars, 2 otherwise - the tolerance the source table's own project used. */
export function isFewCharsAway(a: string, b: string): boolean {
  const budget = Math.max(a.length, b.length) < 8 ? 1 : 2;
  return distance(a, b) <= budget;
}

export type CombinationLookup =
  | {
      status: "resolved";
      rune: string;
      cleaned: string;
      level: number | null;
      quantity: number | null;
      candidates: Combination[];
    }
  | {
      status: "ambiguous" | "no-match" | "bad-index";
      rune?: undefined;
      cleaned: string;
      level: number | null;
      quantity: number | null;
      candidates: Combination[];
    };

/**
 * Resolves the rune at `cellIndex` of a row whose reward text is `rawRowText`
 * and which shows `cellCount` runes.
 *
 * Never guesses. Narrows candidates by cell count, then name (exact, then
 * fuzzy), then level, then quantity - and reports "resolved" only when every
 * surviving candidate agrees on the rune at that index. Anything else comes back
 * as "ambiguous" / "no-match" / "bad-index" for the caller to render as unknown.
 */
export function lookupCombination(
  table: CombinationTable,
  rawRowText: string,
  cellCount: number,
  cellIndex: number,
): CombinationLookup {
  const { key, level, quantity, cleaned } = normalizeComboRowText(rawRowText);
  const sameCount = table.combinations.filter((c) => c.runes.length === cellCount);
  const withKey = sameCount.map((c) => ({ c, key: normalizeComboRowText(c.name).key }));

  let pool = withKey.filter((e) => e.key === key).map((e) => e.c);
  if (pool.length === 0) {
    pool = withKey.filter((e) => isFewCharsAway(e.key, key)).map((e) => e.c);
  }
  if (pool.length === 0) {
    return { status: "no-match", cleaned, level, quantity, candidates: [] };
  }

  if (level !== null) {
    const byLevel = pool.filter((c) => c.level === level);
    if (byLevel.length > 0) pool = byLevel;
  }
  // Same name + same cell count can still be two different real recipes,
  // distinguished only by quantity (e.g. "Arcanist's Etcher" 2x vs 4x both have
  // 2 runes, but different ones). Only narrows when it actually narrows to
  // something: a table with no quantity data for this name leaves the pool
  // untouched rather than filtering everything away.
  if (quantity !== null) {
    const byQuantity = pool.filter((c) => c.quantity === quantity);
    if (byQuantity.length > 0) pool = byQuantity;
  }

  if (cellIndex < 0 || cellIndex >= cellCount) {
    return { status: "bad-index", cleaned, level, quantity, candidates: pool };
  }

  const runesAtIndex = new Set(pool.map((c) => c.runes[cellIndex]));
  if (runesAtIndex.size === 1) {
    return {
      status: "resolved",
      rune: [...runesAtIndex][0],
      cleaned,
      level,
      quantity,
      candidates: pool,
    };
  }
  return { status: "ambiguous", cleaned, level, quantity, candidates: pool };
}
