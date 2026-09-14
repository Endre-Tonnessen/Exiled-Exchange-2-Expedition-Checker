// How a row's runes are rendered. Extracted from WidgetExpedition.vue so the
// settings panel can preview each display mode using the real markup and the
// real rules, rather than a hand-drawn mock-up that drifts from what the widget
// actually does.
//
// Two facts about the mechanic drive all of it:
//
// 1. ONLY GILDED RUNES PROPAGATE. Picking a row grants the reward and seeds its
//    gilded rune(s) onto every later encounter in the chain; the rest of the
//    recipe does nothing beyond that one pick. A trap in a non-gilded slot is a
//    curiosity, the same trap gilded is the reason not to take the row - so the
//    two must not look alike.
// 2. A row can carry MORE THAN ONE gilded rune. Nothing here may assume a
//    single one; the detector reports gilding per cell and this respects that.

import type { ResolvedRune, RuneRating } from "./rune-value";
import { moreUrgent } from "./rune-value";

export type RuneDisplayMode = "summary" | "caged" | "all";

export const RATING_CLASS: Record<RuneRating, string> = {
  great: "text-green-400",
  good: "text-green-600",
  neutral: "text-gray-400",
  poor: "text-orange-400",
  trap: "text-red-400",
  unrated: "text-gray-600",
};

export const RATING_MARK: Record<RuneRating, string> = {
  great: "★",
  good: "",
  neutral: "",
  poor: "",
  trap: "⚠",
  unrated: "",
};

/** Gold underline marks a gilded rune wherever the full list is shown. */
const CAGE_UNDERLINE = "underline underline-offset-2 decoration-yellow-500";

/** A rating worth interrupting you for. Middle ratings are noise under a timer. */
export function isNotable(rune: ResolvedRune): boolean {
  return rune.rating === "trap" || rune.rating === "great";
}

/**
 * An unnamed rune still occupies a slot rather than disappearing: the player can
 * see how many runes the row has, so listing fewer would read as a bug. "?"
 * says we could not name this one, which is common for generic currency rewards.
 */
export function runeLabel(rune: ResolvedRune): string {
  return rune.runeId ?? "?";
}

export function runeTitle(rune: ResolvedRune): string {
  const name = rune.runeId ?? "unidentified rune";
  const cage = rune.carriesForward ? " - GILDED, propagates to later encounters" : "";
  if (!rune.runeId) {
    return `${name}${cage}\nThis row's reward text matches several recipes, so the rune at this position can't be pinned down.`;
  }
  if (rune.rating === "unrated") {
    return `${name} (unrated)${cage}\nNo rating recorded - see data/expedition/rune-ratings.json, which is meant to be edited.`;
  }
  return `${name} (${rune.rating})${cage}\n${rune.why ?? ""}`.trim();
}

/** Which runes the second line lists, for the modes that have one. */
export function runesToShow(runes: ResolvedRune[], mode: RuneDisplayMode): ResolvedRune[] {
  if (mode !== "caged") return runes;
  // Falls back to the full list when nothing was found gilded, rather than
  // showing an empty row: some reward screens genuinely have no gilded cell,
  // and detection misses others, so a blank line would be ambiguous between
  // the two.
  const gilded = runes.filter((r) => r.carriesForward);
  return gilded.length > 0 ? gilded : runes;
}

/**
 * The runes named inline on the row's own line.
 *
 * Prefers gilded ones - plural, since a row may have several - because only
 * those change what taking the row does to the rest of the chain. With nothing
 * gilded and notable, falls back to the single most urgent notable rune, shown
 * dimmed. Returns an empty array for a row with nothing worth saying, which is
 * what keeps a busy panel quiet.
 */
export function rowHighlights(runes: ResolvedRune[]): ResolvedRune[] {
  const notable = runes.filter(isNotable);
  if (notable.length === 0) return [];
  const gilded = notable.filter((r) => r.carriesForward);
  if (gilded.length > 0) {
    return [...gilded].sort((a, b) => (moreUrgent(a.rating, b.rating) ? -1 : 1));
  }
  return [notable.reduce((worst, r) => (moreUrgent(r.rating, worst.rating) ? r : worst))];
}

/**
 * How loudly to render an inline marker. A gilded trap is the strongest signal
 * this widget produces and gets a filled background: colour alone did not
 * separate it from an ordinary orange "poor" rune at a glance.
 */
export function markerClass(rune: ResolvedRune): string {
  if (!rune.carriesForward) {
    // Notable but not gilded: real information, no alarm. Dimmed and smaller so
    // it reads as a footnote beside a gilded marker.
    return `${RATING_CLASS[rune.rating]} opacity-60 text-xs`;
  }
  if (rune.rating === "trap") return "text-red-200 bg-red-800 px-1 rounded font-bold";
  if (rune.rating === "great") return "text-green-200 bg-green-800 px-1 rounded font-bold";
  return `${RATING_CLASS[rune.rating]} font-semibold`;
}

/** Symbol plus name, so an inline marker is actionable without hovering. */
export function markerText(rune: ResolvedRune): string {
  return `${RATING_MARK[rune.rating]}${runeLabel(rune)}`;
}

/** Per-rune styling in the full list. Same rules as the inline marker, so the two lines agree. */
export function runeClass(rune: ResolvedRune): string {
  if (rune.carriesForward && isNotable(rune)) {
    return `${markerClass(rune)} ${CAGE_UNDERLINE}`;
  }
  if (rune.carriesForward) {
    return `${RATING_CLASS[rune.rating]} ${CAGE_UNDERLINE} font-semibold`;
  }
  return RATING_CLASS[rune.rating];
}

/** One row as ExpeditionRow.vue renders it. Lives here rather than in that
 * component because `<script setup>` cannot export types. */
export interface ExpeditionRowData {
  quantity: number;
  displayName: string;
  priceText: string;
  runes: ResolvedRune[];
}
