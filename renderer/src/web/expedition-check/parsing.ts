// Quantity + item-name extraction for OCR'd Expedition "Runeshape Combinations" rows.
// Regexes reimplemented from the published approach of a prior C# price-check
// tool, and tuned against real OCR output from this exact panel - see the regex
// comments below for what each one is compensating for.

const NON_WORD_SPACE = /[^\w\s]/g;
const MULTI_SPACE = /\s+/g;

// leading "Nx" quantity marker; "6x5" (digit right after) is deliberately excluded so a
// misread stack-count-of-a-stack-count doesn't get parsed as the multiplier.
const MULTIPLIER_PATTERN = /(?<![a-z0-9])(\d{1,3})\s*x(?![0-9])/;

// A leading "Nx" even when OCR glued it to the name ("6xarcanist...").
const LEADING_QUANTITY = /^\s*\d{1,3}\s*x(?![0-9])/;

// Runs of 1-2 char tokens, or digit-bearing tokens without a 3+ letter run - this is the
// junk OCR produces from the recipe-cost icon column bleeding into the crop.
const LEADING_NOISE = /^(?:\S{1,2}\s+|(?!\S*\p{L}{3})\S*\d\S*\s+)+/u;

const QUANTITY_MARKER = /(?<!\w)\d+\s*x\s+/;
const LEADING_NON_ALPHA = /^[^\p{L}\p{N}]+/u;

// Trailing bracketed count, e.g. "(3)" - a gem's "(Level 19)" has a space and more than
// 3 chars inside, so it never matches this.
const TRAILING_STACK_COUNT = /\s*[([{]\s*[\p{L}\p{N}]{1,3}\s*[)\]}]\s*$/u;
// Trailing bare "x1" (and OCR's letter-for-digit confusions on it: xl, xI, xO, xS, xB).
const TRAILING_BARE_STACK_COUNT = /\s+x[\dlioOSB]{1,3}\s*$/i;

const MIN_NAME_LENGTH = 4;
const MIN_WORD_LENGTH = 4;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(NON_WORD_SPACE, " ")
    .replace(MULTI_SPACE, " ")
    .trim();
}

// Reverses OCR's letter->digit confusions on the game's stylized font, as a fallback
// lookup key when a normalized name contains a digit that's probably actually a letter.
const DIGIT_FOLD_MAP: Record<string, string> = {
  0: "o",
  1: "l",
  5: "s",
  8: "b",
};

export function digitFold(text: string): string {
  return text.replace(/[0158]/g, (d) => DIGIT_FOLD_MAP[d]);
}

function stripTrailingStackCount(raw: string): string {
  const s = raw.replace(TRAILING_STACK_COUNT, "").trimEnd();
  return s.replace(TRAILING_BARE_STACK_COUNT, "").trimEnd();
}

function stripLeadingNoise(normalized: string): string {
  let s = normalized.replace(LEADING_QUANTITY, "");
  s = s.replace(LEADING_NOISE, "");
  const qm = s.match(QUANTITY_MARKER);
  if (qm && qm.index !== undefined) {
    s = s.slice(qm.index + qm[0].length);
  }
  s = s.replace(LEADING_NON_ALPHA, "");
  return s.trim();
}

export interface ParsedRow {
  quantity: number;
  /** normalized, ready to feed into price-match.ts */
  name: string;
  /** false when no "Nx" prefix was found - quantity defaults to 1 */
  explicitQuantity: boolean;
}

// Returns null for lines that don't look like a reward row at all (the panel title, OCR
// noise from the border texture, etc.) rather than a low-confidence guess.
export function parseLine(raw: string): ParsedRow | null {
  const normalizedRaw = normalize(stripTrailingStackCount(raw));
  if (normalizedRaw.length === 0) return null;

  const multiplierMatch = normalizedRaw.match(MULTIPLIER_PATTERN);
  const explicitQuantity = multiplierMatch !== null;
  const quantity = multiplierMatch
    ? Math.min(parseInt(multiplierMatch[1], 10), 999)
    : 1;

  const name = stripLeadingNoise(normalizedRaw);

  // The panel's own title ("Runeshape Combinations") OCRs cleanly enough to otherwise
  // pass as a (unpriced) row - reject it explicitly, matching the reference app.
  if (name.includes("runeshape")) return null;

  if (name.length < MIN_NAME_LENGTH) return null;
  const wordRun = new RegExp(`\\p{L}{${MIN_WORD_LENGTH},}`, "u");
  if (!wordRun.test(name)) return null;

  return { quantity, name, explicitQuantity };
}

// The reward forms that carry no "Nx" quantity prefix: "Skill Level 20: Rain of
// Blades", "Support: Healing Runes". Matched on the RAW line, before normalize()
// strips the colon this keys on.
//
// Together with parseLine()'s `explicitQuantity`, this is what separates a real
// reward row from stray text that merely happens to sit inside the capture
// region - a chest label ("Overgrown Clam"), a monster name - which otherwise
// parses perfectly well as a nameless, priceless row. Measured against all nine
// real panel captures in ocr-playground/fixtures: every reward row in every one
// of them carries one marker or the other. The only lines that don't are the
// panel's own title (handled separately, and itself proof the panel is open),
// second lines of a two-line row, and one single-row crop where OCR dropped the
// quantity digit outright - none of which is a whole panel's worth of evidence.
// So this is a test for "is the PANEL open", needing one qualifying row, and
// never a filter on which rows get displayed.
const GEM_REWARD_FORM = /^\s*(skill|spirit|support)\b[^:]*:/i;

export function looksLikeGemReward(raw: string): boolean {
  return GEM_REWARD_FORM.test(raw);
}

const GEM_TYPE_PATTERN = /\b(skill|spirit|support)\b/;
const GEM_LEVEL_PATTERN = /\blevel\s+(\d+)\b/;

export type GemResolution =
  | { isGemRow: false }
  | { isGemRow: true; key: string | null };

// Uncut gems are priced per exact type+level (neighbouring levels can differ several-fold),
// so this deliberately returns key:null - never a fuzzy fallback guess - when the row is
// clearly a gem but the level couldn't be read cleanly. Callers must show "?" in that case,
// not fall through to normal price matching.
export function resolveGemKey(normalizedName: string): GemResolution {
  if (!normalizedName.includes("gem")) return { isGemRow: false };

  const type = normalizedName.match(GEM_TYPE_PATTERN);
  if (!type) return { isGemRow: false };

  const level = normalizedName.match(GEM_LEVEL_PATTERN);
  if (!level) return { isGemRow: true, key: null };

  return { isGemRow: true, key: `uncut ${type[1]} gem level ${level[1]}` };
}
