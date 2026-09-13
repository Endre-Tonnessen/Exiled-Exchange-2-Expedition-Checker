// Exact -> digit-folded exact -> prefix -> fuzzy price resolution, ported (algorithm,
// not code) from a prior C# price-check tool. Uses the
// already-installed `fastest-levenshtein` package instead of hand-rolling Levenshtein.
import { distance } from "fastest-levenshtein";
import type { FlatPriceEntry } from "@/web/background/Prices";
import { normalize, digitFold } from "./parsing";

export type { FlatPriceEntry };

export interface PriceIndex {
  byName: Map<string, FlatPriceEntry>;
  keysByLength: Map<number, string[]>;
}

export function buildPriceIndex(entries: FlatPriceEntry[]): PriceIndex {
  const byName = new Map<string, FlatPriceEntry>();
  for (const entry of entries) {
    const key = normalize(
      entry.variant ? `${entry.name} ${entry.variant}` : entry.name,
    );
    byName.set(key, entry);
  }

  const keysByLength = new Map<number, string[]>();
  for (const key of byName.keys()) {
    const bucket = keysByLength.get(key.length);
    if (bucket) bucket.push(key);
    else keysByLength.set(key.length, [key]);
  }

  return { byName, keysByLength };
}

export interface ResolvedPrice {
  entry: FlatPriceEntry;
  matchedKey: string;
  /** true for an exact/digit-folded/prefix match, or a high-confidence (>=0.92) fuzzy one */
  exact: boolean;
}

const PREFIX_MIN_LENGTH = 10;
const FUZZY_MIN_LENGTH = 6;
const FUZZY_THRESHOLD = 0.84;
const HIGH_CONFIDENCE_THRESHOLD = 0.92;

export function resolvePrice(
  name: string,
  index: PriceIndex,
): ResolvedPrice | null {
  const exact = index.byName.get(name);
  if (exact) return { entry: exact, matchedKey: name, exact: true };

  // Only when the name contains a digit that's probably an OCR letter->digit
  // misread; prefix/fuzzy below operate on this folded form too, matching the
  // reference implementation, so a folded name benefits from every fallback stage.
  const lookup = /\d/.test(name) ? digitFold(name) : name;

  if (lookup !== name) {
    const foldedMatch = index.byName.get(lookup);
    if (foldedMatch) {
      return { entry: foldedMatch, matchedKey: lookup, exact: true };
    }
  }

  if (lookup.length >= PREFIX_MIN_LENGTH) {
    let bestKey: string | null = null;
    for (const key of index.byName.keys()) {
      if (
        key.startsWith(lookup) &&
        (bestKey === null || key.length < bestKey.length)
      ) {
        bestKey = key;
      }
    }
    if (bestKey !== null) {
      return { entry: index.byName.get(bestKey)!, matchedKey: bestKey, exact: true };
    }
  }

  if (lookup.length >= FUZZY_MIN_LENGTH) {
    const fuzzy = bestFuzzyMatch(lookup, index);
    if (fuzzy) {
      return {
        entry: index.byName.get(fuzzy.key)!,
        matchedKey: fuzzy.key,
        exact: fuzzy.score >= HIGH_CONFIDENCE_THRESHOLD,
      };
    }
  }

  return null;
}

function bestFuzzyMatch(
  name: string,
  index: PriceIndex,
): { key: string; score: number } | null {
  let bestKey: string | null = null;
  let bestScore = FUZZY_THRESHOLD;

  for (let len = Math.max(0, name.length - 3); len <= name.length + 3; len++) {
    const bucket = index.keysByLength.get(len);
    if (!bucket) continue;
    for (const key of bucket) {
      const dist = distance(name, key);
      const score = 1 - dist / Math.max(name.length, key.length);
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
  }

  return bestKey !== null ? { key: bestKey, score: bestScore } : null;
}
