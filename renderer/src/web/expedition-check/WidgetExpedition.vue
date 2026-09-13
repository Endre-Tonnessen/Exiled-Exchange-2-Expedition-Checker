<template>
  <Widget :config="config" move-handles="corners" :inline-edit="false">
    <div :style="{ width: containerWidth }">
      <div v-if="!config.region" class="widget-default-style p-3 text-gray-100 text-lg text-gray-500">
        {{ t(":no_region") }}
      </div>
      <div
        v-else-if="rows.length === 0"
        class="widget-default-style p-3 text-gray-100 text-lg text-gray-500"
      >
        {{ t(":no_data") }}
      </div>
      <!-- Sized to the same on-screen height as the capture region (regionHeightVh)
           so each row's `top: Y%` lands next to its actual row in the game panel,
           rather than the rows being stacked top-to-bottom in a separate list. -->
      <div v-else :style="{ position: 'relative', height: regionHeightVh }">
        <!-- Price first and never truncated (the primary information at a glance);
             name second, smaller/muted and free to truncate - it's only there for
             the edge case of checking what OCR actually recognized, not something
             read during normal play. Price-first also means every price starts at
             the same left-aligned X by construction, so - unlike the previous
             price-on-the-right layout - no width computation is needed just to
             keep them lined up. -->
        <div
          v-for="(row, i) in rows"
          :key="i"
          class="widget-default-style absolute left-0 w-full flex items-baseline gap-2 px-3 py-1.5 whitespace-nowrap"
          :style="rowStyle(row)"
        >
          <span class="shrink-0 text-lg font-semibold" :class="priceColorClass(row)">{{ row.priceText }}</span>
          <span class="truncate min-w-0 text-sm text-gray-500">{{ row.quantity }}x {{ row.displayName }}</span>
        </div>
      </div>
      <div
        v-if="config.showRawOcr && rawRows.length"
        class="widget-default-style mt-1 p-2 text-sm text-gray-500"
      >
        <div v-for="(row, i) in rawRows" :key="i">{{ row.text }}</div>
      </div>
    </div>
  </Widget>
</template>

<script lang="ts">
import type { WidgetSpec } from "../overlay/interfaces";

export default {
  widget: {
    type: "expedition-check",
    instances: "multi",
    trNameKey: "expedition_check.name",
  } satisfies WidgetSpec,
};
</script>

<script setup lang="ts">
import { shallowRef, computed, inject, watch, onUnmounted } from "vue";
import { useI18nNs } from "@/web/i18n";
import { Host } from "@/web/background/IPC";
import { displayRounding, usePoeninja } from "@/web/background/Prices";
import type { WidgetManager } from "../overlay/interfaces";
import type { ExpeditionWidget } from "../overlay/widgets";
import Widget from "../overlay/Widget.vue";
import { parseLine, resolveGemKey } from "./parsing";
import { buildPriceIndex, resolvePrice } from "./price-match";
import { DEFAULT_REGION } from "./region";

// Only the categories that can actually appear as Runeshape Combinations costs -
// matches a prior tool's curated list, avoiding false fuzzy matches
// against unrelated poe.ninja categories (Essences, Omens, etc.).
const EXPEDITION_PRICE_CATEGORIES = [
  "Currency",
  "Runes",
  "Expedition",
  "Verisium",
  "UncutGems",
];

const props = defineProps<{
  config: ExpeditionWidget;
}>();

const wm = inject<WidgetManager>("wm")!;
const { t } = useI18nNs("expedition_check");
const { getFlatPriceEntries, queuePricesFetch, autoCurrency } = usePoeninja();

// Sits just right of the capture region, top edge aligned with it - re-applied
// whenever the region is (re)calibrated, so the results panel follows it. A manual
// drag afterward (via this widget's own move handles) simply overwrites `anchor`
// again and stands until the next region change.
function positionRightOfRegion(region: {
  x: number;
  y: number;
  width: number;
}) {
  props.config.anchor = {
    pos: "tl",
    x: Math.min((region.x + region.width) * 100 + 1, 95),
    y: region.y * 100,
  };
}

if (props.config.wmFlags[0] === "uninitialized") {
  props.config.mode = "hotkey";
  props.config.hotkey = "Shift + M";
  props.config.region = { ...DEFAULT_REGION };
  positionRightOfRegion(props.config.region);
  props.config.pollIntervalMs = 700;
  props.config.showRawOcr = false;
  props.config.colorCodeValues = true;
  props.config.uncapNameWidth = true;
  wm.show(props.config.wmId);
}
// Backfill for a widget saved before these existed - strict undefined checks,
// not falsy, so an existing user's deliberate "off" is never overwritten.
if (props.config.colorCodeValues === undefined) {
  props.config.colorCodeValues = true;
}
if (props.config.uncapNameWidth === undefined) {
  props.config.uncapNameWidth = true;
}
// No "invisible-on-blur" here (unlike e.g. Stopwatch, which this was originally
// modeled on): the whole point of this widget is to show scan results *during*
// normal play, i.e. exactly while the overlay is unfocused/click-through.
props.config.wmFlags = [];

watch(
  () => props.config.region,
  (region) => {
    if (region) positionRightOfRegion(region);
  },
);

interface RawRow {
  text: string;
  /** fraction (0-1) of the capture region's height */
  y: number;
  /** fraction (0-1) of the capture region's height */
  height: number;
}

const rawRows = shallowRef<RawRow[]>([]);

// The rows container (template) is set to this exact height so each row's
// `top: Y%` (in rowStyle below) lines up with that row's actual position in the
// game panel - Y is a fraction of the *region's* height, and vh keeps that
// consistent with how Widget.vue's own anchor positioning already works (it's
// computed from window.innerWidth/innerHeight, not a CSS-relative ancestor).
const regionHeightVh = computed(() => `${(props.config.region?.height ?? 0) * 100}vh`);

// uncapNameWidth (on by default) grows this to fit the longest currently-visible
// row so the full name always has room to render, using a `ch`-based
// per-character estimate (see git history for the original width computation
// this replaced). Turned off, it's a fixed compact width and the name is
// allowed to truncate within it (see the row markup).
const containerWidth = computed(() => {
  if (!props.config.uncapNameWidth) return "16rem";
  const longest = rows.value.reduce((max, r) => {
    const len = `${r.quantity}x ${r.displayName}`.length + r.priceText.length;
    return Math.max(max, len);
  }, 20);
  return `${longest + 6}ch`;
});

function rowStyle(row: DisplayRow) {
  return {
    top: `calc(${row.y * 100}% + ${(row.height * 100) / 2}% )`,
    transform: "translateY(-50%)",
  };
}

// Once a scan finds real rows, keep re-scanning the same region on a timer so the
// display can clear itself again once you close the panel - reuses the exact same
// OCR round-trip a hotkey press triggers (CLIENT->MAIN::request-ocr was already
// wired up main-process-side for this), just fired on an interval instead of a
// keypress. No new main-process code needed.
const POLL_INTERVAL_MS = 1500;
const CLOSE_AFTER_EMPTY_POLLS = 2;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let emptyPollCount = 0;

function stopWatching() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startWatching() {
  if (pollTimer !== null) return; // already watching
  emptyPollCount = 0;
  pollTimer = setInterval(() => {
    if (!props.config.region) {
      stopWatching();
      return;
    }
    Host.sendEvent({
      name: "CLIENT->MAIN::request-ocr",
      payload: {
        target: "expedition-price",
        region: props.config.region,
      },
    });
  }, POLL_INTERVAL_MS);
}

onUnmounted(stopWatching);

interface DisplayRow {
  quantity: number;
  displayName: string;
  priceText: string;
  /** fraction (0-1) of the capture region's height - see rowStyle() */
  y: number;
  height: number;
  /** total (quantity-adjusted) value in the same unit price-match.ts's entries
   * use, null when unresolved - the ranking key for valueTier below, kept
   * separate from priceText since that's already formatted/currency-converted
   * for display and no longer comparable across rows. */
  totalValue: number | null;
  /** rank among this poll's *other resolved* rows - null when unresolved (a "?"
   * row is never colored regardless of this or the colorCodeValues setting).
   * See buildRows() for how ties are handled. */
  valueTier: "high" | "mid" | "low" | null;
}

// Every line that parses as a plausible reward row (parseLine already rejects the
// panel title and anything too short/wordless to be real) is shown - at "?" if no
// price resolves, rather than silently dropped. That used to not be true: with the
// previous Tesseract-based engine, an unresolved line was disproportionately likely
// to be icon-glyph noise misread as text, so dropping it kept the display clean
// without much real loss. Windows OCR doesn't produce that kind of noise (validated
// against every real test capture - see EXPEDITION_CHECK.md), so an unresolved line
// now is far more likely to be a real reward with no price *data* available -
// several ordinary named skill/support gem rewards (e.g. "Skill Level 20: Conductive
// Runes", "Support: Concussive Runes") were confirmed to have no matching category
// anywhere in the price feed at all, not a matching bug. Surfacing "?" makes that
// visible instead of silently invisible, whether the cause is missing data or an
// actual bug - either way, seeing the row is strictly more useful than not.
//
// Gem rows (resolveGemKey) still route through their own key rather than the raw
// name for a resolved price - and must never guess when the level can't be read
// (gem.key === null), since adjacent levels differ several-fold in price.
//
// The OCR engine (main/src/vision/WindowsOcr.ts) doesn't expose any per-word
// confidence score to filter on in the first place - worth knowing if it's ever
// tempting to add that back. It was tried with the previous Tesseract-based engine
// and rejected: real proper-noun words ("Uhtred's", "Gemcutter's") scored in the
// exact same low range as pure icon-glyph garbage, so confidence-based stripping
// collapsed distinct items like the five "X's Saga" recipes down to the same bare,
// ambiguous "Saga", risking a fuzzy-match onto the wrong one. Matching against the
// full, unedited line avoids that failure mode entirely.
function buildRows(sourceRows: RawRow[]): DisplayRow[] {
  const priceIndex = buildPriceIndex(
    getFlatPriceEntries(EXPEDITION_PRICE_CATEGORIES),
  );
  const out: DisplayRow[] = [];

  for (const raw of sourceRows) {
    const parsed = parseLine(raw.text);
    if (!parsed) continue;

    const gem = resolveGemKey(parsed.name);
    const lookupKey = gem.isGemRow ? gem.key : parsed.name;

    let priceText = "?";
    let totalValue: number | null = null;
    if (lookupKey) {
      const resolved = resolvePrice(lookupKey, priceIndex);
      if (resolved) {
        totalValue = resolved.entry.primaryValue * parsed.quantity;
        priceText = formatPrice(resolved.entry.primaryValue, parsed.quantity);
      }
    }
    out.push({
      quantity: parsed.quantity,
      displayName: parsed.name,
      priceText,
      y: raw.y,
      height: raw.height,
      totalValue,
      valueTier: null, // filled in below, once every row's totalValue is known
    });
  }

  assignValueTiers(out);
  return out;
}

// Ranks by total value among this poll's own resolved rows - relative, not an
// absolute currency cutoff, so it stays meaningful as the league's economy
// drifts over time without ever needing retuning, and it directly answers the
// actual decision under a timer: "which of these specific options is best,"
// not "is this above some number picked three leagues ago." The highest value
// is tiered "high" and the lowest "low" even when only one resolved row exists
// (or every resolved row ties) - "this is the best available" is still a true,
// non-misleading statement with only one option, so there's no separate
// "can't compare" state to design for.
function assignValueTiers(rows: DisplayRow[]): void {
  const values = rows
    .map((r) => r.totalValue)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return;

  const max = Math.max(...values);
  const min = Math.min(...values);
  for (const row of rows) {
    if (row.totalValue === null) continue;
    row.valueTier = row.totalValue === max ? "high" : row.totalValue === min ? "low" : "mid";
  }
}

function formatPrice(primaryValueDivine: number, quantity: number): string {
  const currencyValue = autoCurrency(primaryValueDivine * quantity);
  return `${displayRounding(currencyValue.min, false, true)} ${currencyValue.currency}`;
}

const VALUE_TIER_CLASS: Record<"high" | "mid" | "low", string> = {
  high: "text-green-400",
  mid: "text-yellow-400",
  low: "text-red-400",
};

function priceColorClass(row: DisplayRow): string {
  if (row.priceText === "?") return "text-gray-500";
  if (props.config.colorCodeValues && row.valueTier) return VALUE_TIER_CLASS[row.valueTier];
  return "text-gray-100";
}

Host.onEvent("MAIN->CLIENT::ocr-text", (e) => {
  if (e.target !== "expedition-price") return;
  // Expresses interest right when we're about to need fresh prices, matching how
  // other widgets (e.g. item-search) drive usePoeninja()'s lazy/throttled fetch.
  queuePricesFetch();
  // e.rows is only optional in the shared IPC type for the "heist-gems" target's
  // sake (it never sends one) - main always sends it for "expedition-price".
  const newRows = e.rows ?? e.paragraphs.map((text) => ({ text, y: 0, height: 0 }));
  rawRows.value = newRows;

  if (buildRows(newRows).length > 0) {
    emptyPollCount = 0;
    startWatching();
  } else if (pollTimer !== null && ++emptyPollCount >= CLOSE_AFTER_EMPTY_POLLS) {
    // A couple of consecutive empty reads in a row (not just one - a stray bad
    // frame shouldn't clear real results) means the panel's most likely closed.
    // Same "resolves to something real" check as the display filter, so icon-glyph
    // noise that happens to parse can't keep this thinking the panel is still open.
    rawRows.value = [];
    stopWatching();
  }
});

// Rebuilt from getFlatPriceEntries()'s current snapshot each time rawRows changes,
// rather than cached in its own computed - getFlatPriceEntries() reads a plain,
// non-reactive variable inside usePoeninja(), so a separately-cached index would
// have no reactive dependency to invalidate on and could get stuck on stale (or
// empty, pre-fetch) data forever. Tying it to `rawRows` instead means it's rebuilt
// exactly when there's new OCR output to price anyway - cheap, for ~100 entries.
const rows = computed<DisplayRow[]>(() => buildRows(rawRows.value));
</script>
