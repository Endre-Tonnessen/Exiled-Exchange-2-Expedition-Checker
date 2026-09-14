// Loading the two rune data files, and turning a rune id into a verdict.
//
// Both files live in `public/data/expedition/` and are fetched at runtime
// rather than bundled - see that directory's README.md. For the ratings file
// that placement is the point: it is opinion, explicitly meant to be edited,
// and bundling it would put it out of the user's reach in an installed build.

import {
  lookupCombination,
  type CombinationTable,
  type Combination,
} from "./rune-identity";

/**
 * How good a rune is to PROPAGATE. Note that "unrated" is its own state, not a
 * synonym for "neutral": neutral is a claim that the rune is harmless, unrated
 * means nobody has judged it and the UI should say so. Most runes are unrated
 * on purpose - see the ratings file's own notes.
 */
export type RuneRating = "great" | "good" | "neutral" | "poor" | "trap" | "unrated";

export interface RuneRatingEntry {
  id: string;
  rating: Exclude<RuneRating, "unrated">;
  why?: string;
  source?: string;
  confidence?: string;
}

export interface RuneRatingsFile {
  runes: RuneRatingEntry[];
}

export interface RuneVerdict {
  rating: RuneRating;
  why: string | null;
}

const UNRATED: RuneVerdict = { rating: "unrated", why: null };

/**
 * A rune's propagation verdict. A rune with no entry reports "unrated" rather
 * than defaulting to anything - a wrong rating here would tell you to take a
 * trap, which is worse than saying nothing.
 */
export function runeVerdict(
  ratings: RuneRatingsFile | null,
  runeId: string | null,
): RuneVerdict {
  if (!runeId || !ratings) return UNRATED;
  const entry = ratings.runes.find((r) => r.id === runeId);
  if (!entry) return UNRATED;
  return { rating: entry.rating, why: entry.why ?? null };
}

/** Ordering used to pick the most noteworthy rune in a row. Worst first is deliberate: a trap you are about to take matters more than a good rune you might miss. */
const RATING_URGENCY: Record<RuneRating, number> = {
  trap: 0,
  great: 1,
  poor: 2,
  good: 3,
  neutral: 4,
  unrated: 5,
};

export function moreUrgent(a: RuneRating, b: RuneRating): boolean {
  return RATING_URGENCY[a] < RATING_URGENCY[b];
}

let combinationsPromise: Promise<CombinationTable> | null = null;
let ratingsPromise: Promise<RuneRatingsFile> | null = null;

async function fetchJson<T>(path: string, fallback: T, label: string): Promise<T> {
  try {
    const resp = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as T;
  } catch (e) {
    // Degrade rather than throw: without these files every rune simply reports
    // as unknown/unrated, which is a usable (if useless) state. Throwing here
    // would take the whole widget down, including the reward pricing that has
    // nothing to do with runes.
    console.error(`Failed to load ${label} - runes will show as unresolved.`, e);
    return fallback;
  }
}

/** The poe2db recipe table: reward name -> ordered rune list. Fetched once. */
export function loadCombinationTable(): Promise<CombinationTable> {
  combinationsPromise ??= fetchJson<CombinationTable>(
    "data/expedition/rune-combinations.json",
    { combinations: [] },
    "rune-combinations.json",
  );
  return combinationsPromise;
}

/** The propagation ratings. Fetched once. */
export function loadRuneRatings(): Promise<RuneRatingsFile> {
  ratingsPromise ??= fetchJson<RuneRatingsFile>(
    "data/expedition/rune-ratings.json",
    { runes: [] },
    "rune-ratings.json",
  );
  return ratingsPromise;
}

export interface ResolvedRune {
  index: number;
  /** null when the reward text could not be resolved to a single recipe */
  runeId: string | null;
  rating: RuneRating;
  why: string | null;
  /** this slot propagates to every later encounter in the chain */
  carriesForward: boolean;
  /** the rune's own frame colour, as detected - independent of the cage */
  tier: "none" | "gold" | "purple" | "blue";
}

/**
 * Names every rune in one row and attaches its verdict.
 *
 * Resolves EVERY cell, not just the caged one. Detecting the cage is the least
 * reliable part of the vision layer, but a player can see the cage perfectly
 * well themselves - what they cannot do at a glance is name the rune inside it.
 * So label them all and let the eye pick; the detected cage is a convenience on
 * top, not a dependency.
 */
export function resolveRowRunes(
  table: CombinationTable,
  ratings: RuneRatingsFile | null,
  rewardText: string,
  cells: Array<{ carriesForward: boolean; tier: ResolvedRune["tier"] }>,
): ResolvedRune[] {
  return cells.map((cell, index) => {
    const lookup = lookupCombination(table, rewardText, cells.length, index);
    const runeId = lookup.status === "resolved" ? lookup.rune : null;
    const verdict = runeVerdict(ratings, runeId);
    return {
      index,
      runeId,
      rating: verdict.rating,
      why: verdict.why,
      carriesForward: cell.carriesForward,
      tier: cell.tier,
    };
  });
}

export type { CombinationTable, Combination };
