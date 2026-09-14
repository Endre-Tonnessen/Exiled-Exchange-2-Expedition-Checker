<template>
  <Widget :config="config" move-handles="corners" :inline-edit="false">
    <div :style="{ width: containerWidth }">
      <div v-if="!config.region" class="widget-default-style p-3 text-gray-100 text-lg text-gray-500">
        {{ t(":no_region") }}
      </div>
      <!-- WHILE PLAYING, renders nothing at all unless the Combinations panel
           is actually on screen: "no rows" is the normal state for most of a
           session, and a placeholder for it meant a permanent box sitting over
           the game while just clearing a map.
           WHILE THE OVERLAY IS FOCUSED, always renders - because then the user
           is looking at the widget rather than through it. That covers showing
           it from the widget menu (with nothing rendered there is no widget to
           see, position, or believe in) and reading the last results while
           changing settings. `overlayActive` is false during normal
           click-through play, which is what keeps the two cases apart.
           showScanAck is the third case: a hotkey scan that found nothing says
           so briefly, so a keypress is never silently ignored. -->
      <template v-else-if="panelOpen || showScanAck || overlayActive">
        <!-- Two different empty states, because they answer different
             questions. With the panel open, "nothing recognized" is a result
             and possibly a problem (bad region, unreadable text). With the
             overlay merely focused and no panel at all, nothing is wrong - the
             widget just needs to be VISIBLE and big enough to hover, so it can
             be dragged and its edit button reached. Naming the widget is what
             makes it identifiable among other widgets in edit mode. -->
        <div
          v-if="rows.length === 0 && !panelOpen && !showScanAck"
          class="widget-default-style p-3 text-gray-500"
        >
          <div class="text-gray-100 text-lg">{{ t(":name") }}</div>
          <div class="text-sm">
            {{ config.continuousScan ? t(":idle_watching") : t(":idle_hotkey", [config.hotkey ?? "-"]) }}
          </div>
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
          <div
            v-for="(row, i) in rows"
            :key="i"
            class="widget-default-style absolute left-0 w-full px-3 py-1.5 whitespace-nowrap"
            :style="rowStyle(row)"
          >
            <ExpeditionRow
              :row="row"
              :mode="config.runeDisplay"
              :price-class="priceColorClass(row)"
            />
          </div>
        </div>
      </template>
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
import {
  shallowRef,
  computed,
  inject,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
} from "vue";
import { useI18nNs } from "@/web/i18n";
import { pushHostConfig } from "@/web/Config";
import { Host } from "@/web/background/IPC";
import { displayRounding, usePoeninja } from "@/web/background/Prices";
import type { WidgetManager } from "../overlay/interfaces";
import type { ExpeditionWidget } from "../overlay/widgets";
import Widget from "../overlay/Widget.vue";
import { looksLikeGemReward, normalize, parseLine, resolveGemKey } from "./parsing";
import { buildPriceIndex, resolvePrice } from "./price-match";
import { DEFAULT_REGION } from "./region";
import {
  loadCombinationTable,
  loadRuneRatings,
  resolveRowRunes,
  type CombinationTable,
  type RuneRatingsFile,
  type ResolvedRune,
} from "./rune-value";
import ExpeditionRow from "./ExpeditionRow.vue";
import { rowHighlights, markerText } from "./rune-display";

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

// Declared up here only because the init/migration block below runs at setup
// time and reads it - the reasoning for the value, and the rest of the polling
// constants, live in the panel-detection section further down.
const DEFAULT_POLL_INTERVAL_MS = 3000;

const props = defineProps<{
  config: ExpeditionWidget;
}>();

const wm = inject<WidgetManager>("wm")!;
// True while the overlay itself is focused - i.e. the user is interacting with
// the overlay UI rather than playing through it (see OverlayWindow.vue, which
// sets this from MAIN->OVERLAY::focus-change). Aliased to a top-level binding
// so the template gets automatic ref unwrapping.
const overlayActive = wm.active;
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

const freshlyCreated = props.config.wmFlags[0] === "uninitialized";
if (freshlyCreated) {
  props.config.mode = "hotkey";
  props.config.hotkey = "Shift + M";
  props.config.region = { ...DEFAULT_REGION };
  positionRightOfRegion(props.config.region);
  props.config.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  props.config.showRawOcr = false;
  props.config.colorCodeValues = true;
  props.config.uncapNameWidth = true;
  props.config.trackRunes = false;
  props.config.runeDisplay = "summary";
  props.config.continuousScan = false;
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
// Rune tracking defaults OFF, including for existing widgets: it is a new,
// second layer on top of pricing that already works, and an upgrade should not
// silently start doing extra per-frame image analysis for someone who never
// asked for it.
if (props.config.trackRunes === undefined) {
  props.config.trackRunes = false;
}
if (props.config.runeDisplay === undefined) {
  props.config.runeDisplay = "summary";
}
// Continuous watching defaults OFF, including for existing widgets, for the
// same reason rune tracking does: it makes the app do real, repeated work
// (a screenshot and an OCR subprocess per tick, forever) that the previous
// behaviour did not, and an upgrade must not start doing that for someone who
// never asked. Hotkey-driven scanning stays the default.
if (props.config.continuousScan === undefined) {
  props.config.continuousScan = false;
}
// `pollIntervalMs` existed in the config type from the start but nothing ever
// read it - the poll ran on a hardcoded constant. Now that it drives a timer
// that runs for the whole session, the stored 700 every existing widget was
// initialized with would mean a screenshot + OCR subprocess roughly every
// 0.7s forever, which is not what anyone chose: it was a dead default nobody
// could see or change. Migrate exactly that value (and unset) to the real
// one; any other value is a deliberate user choice and is left alone.
if (
  props.config.pollIntervalMs === undefined ||
  props.config.pollIntervalMs === 700
) {
  props.config.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
}
// No "invisible-on-blur" here (unlike e.g. Stopwatch, which this was originally
// modeled on): the whole point of this widget is to show scan results *during*
// normal play, i.e. exactly while the overlay is unfocused/click-through.
props.config.wmFlags = [];

// The scan hotkey is a GLOBAL shortcut, registered by main from the host config
// (see Config.ts's "expedition-check" branch, which turns this widget's hotkey
// and region into an "ocr-text" action). Main is only told about that config on
// two occasions: app startup, and pressing Save in settings. Creating a widget
// is neither - so a freshly added widget's hotkey did nothing at all until the
// user happened to open its settings and save, which looked like the widget had
// failed to start.
//
// Pushing it here is the same fix WidgetStashSearch.vue already applies for the
// same reason, and it stays inside this widget rather than in the shared
// creation path, so the change remains local to the fork.
//
// Deferred to mounted + nextTick so the assignments above are in the config
// getConfigForHost() reads, and only for a new widget - at startup
// OverlayWindow.vue has already pushed the same thing.
if (freshlyCreated) {
  onMounted(() => {
    nextTick(() => {
      pushHostConfig();
    });
  });
}

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

// --- Rune layer (independent of everything above) -------------------------
// Arrives on its own IPC event, at its own time, and may be absent entirely
// while the price rows above work perfectly well. Nothing in the pricing path
// reads any of this.

interface RuneCell {
  index: number;
  x: number;
  width: number;
  y: number;
  height: number;
  tier: "none" | "gold" | "purple" | "blue";
  carriesForward: boolean;
}

interface RuneRow {
  y: number;
  height: number;
  cells: RuneCell[];
}

const runeRows = shallowRef<RuneRow[]>([]);
const comboTable = shallowRef<CombinationTable | null>(null);
const runeRatings = shallowRef<RuneRatingsFile | null>(null);

// Fetched once, and only if the user has the layer switched on - no reason to
// pull ~48KB of recipe data for someone who never enables it. Re-checked on
// toggle rather than at startup.
let runeDataRequested = false;
function ensureRuneData() {
  if (runeDataRequested) return;
  runeDataRequested = true;
  loadCombinationTable().then((t) => {
    comboTable.value = t;
  });
  loadRuneRatings().then((r) => {
    runeRatings.value = r;
  });
}
watch(
  () => props.config.trackRunes,
  (on) => {
    if (on) ensureRuneData();
    // Clear stale rune results the moment the layer is switched off, so the
    // display cannot keep showing hints derived from a scan that is no longer
    // running.
    else runeRows.value = [];
  },
  { immediate: true },
);

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
    // The inline rune markers share the price line, so they have to be counted
    // or they wrap - which would silently undo the whole point of the one-line
    // summary mode by making rows two lines tall again anyway. Plural: a row
    // can carry more than one gilded rune.
    const markerLen = rowHighlights(r.runes).reduce(
      (n, rune) => n + markerText(rune).length + 1,
      0,
    );
    const len =
      `${r.quantity}x ${r.displayName}`.length + r.priceText.length + markerLen;
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

// --- Panel detection and polling ------------------------------------------
//
// PoE2 exposes nothing that says "the Runeshape Combinations panel is open" -
// no API, no separate window, no client log line. The only evidence available
// is what is inside the capture region, so "open" has to be INFERRED from the
// scan this widget already runs for pricing. That is what panelSignal() below
// does, and it is the whole basis for the widget appearing and disappearing on
// its own.
//
// There are two scanning modes, and the difference is only WHEN the timer
// runs - the detection logic below is identical in both:
//
//   continuousScan off (default) - the timer starts when a hotkey scan finds
//     something and stops again once the panel is gone. The pre-existing
//     behaviour. Nothing is scanned while you are just playing.
//   continuousScan on (experimental) - the timer runs for the whole session,
//     because a timer that only starts once something has been found can never
//     be the thing that notices the panel OPENING. That is the only way the
//     widget can appear on its own, and it is also why the setting is off by
//     default: every tick is one game-window screenshot plus one Windows-OCR
//     call (which main services by spawning a PowerShell subprocess), forever.
//
// Either way the interval is the user's, which is why it is a setting.
// (DEFAULT_POLL_INTERVAL_MS itself is declared at the top of the script, where
// the config migration needs it.)
//
// Floor/ceiling applied at USE time, not on the stored value, so a hand-edited
// or future-changed config can never turn this into a screenshot-per-frame
// loop, and a typo'd huge number can't silently disable the widget.
const MIN_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 30000;
const CLOSE_AFTER_EMPTY_POLLS = 2;

// While the panel is OPEN the timer does a different job, so it runs at a
// different rate - fixed, and much faster than the user's watch interval.
//
// The setting answers "how often should I look for the panel opening", which is
// the expensive question: it runs all session and every tick costs a screenshot
// and an OCR subprocess. Once the panel is open the question is "is it still
// there, and are the values current", which is asked perhaps a dozen times per
// encounter and needs to be answered promptly - results that outlive the panel
// by several seconds read as stale.
//
// Tying both to one number made raising the watch interval (the whole point of
// the setting) also make the display slower to clear, which is backwards. At
// 700ms and CLOSE_AFTER_EMPTY_POLLS=2 the widget clears about 1.5-2s after the
// panel goes, against a measured ~300ms OCR round trip, so requests never pile
// up.
const ACTIVE_POLL_INTERVAL_MS = 700;
/** How long a manual scan that found nothing stays acknowledged on screen. */
const SCAN_ACK_MS = 2000;

/** True while the Combinations panel is believed to be on screen. */
const panelOpen = shallowRef(false);
/** True briefly after a HOTKEY scan that found nothing - see the template. */
const showScanAck = shallowRef(false);

// The panel's own title is a positive "the panel is open" signal even though
// parseLine() deliberately rejects it as a reward *row*. Checking it separately
// is what lets "open, but nothing recognized yet" be told apart from "not
// open" - which is the entire distinction the placeholder now hangs on. It is
// only ever a bonus: a capture region cropped tight to the reward rows (the
// default one is) simply never sees the title, and detection falls back to the
// reward rows themselves, which is the common case.
const PANEL_TITLE = "runeshape";

/**
 * How strongly this scan says "the Combinations panel is open".
 *
 * "strong" - the panel's title, or a line carrying a reward row's own markers
 *            (an explicit "Nx" quantity, or the "Skill Level 20:"/"Support:"
 *            form). One qualifying line is enough; see looksLikeGemReward()
 *            for the measurement behind that.
 * "weak"   - something parsed as a row, but nothing that a reward row is
 *            recognisable BY. This is what stray world text looks like: a
 *            chest label or monster name sitting inside the capture region
 *            parses perfectly well as a nameless, priceless row.
 * "none"   - nothing parsed at all.
 *
 * The distinction exists because "weak" was being treated as proof the panel
 * was open. That put a spurious "?" row on screen just after closing the
 * panel, and - worse, because it also reset the close countdown - a label that
 * stayed in the region would have held the widget open, polling every 700ms,
 * indefinitely.
 */
function panelSignal(source: RawRow[]): "strong" | "weak" | "none" {
  let weak = false;
  for (const row of source) {
    // Checked first and separately: parseLine() deliberately rejects the title
    // as a reward row, but it is the most direct evidence there is.
    if (normalize(row.text).includes(PANEL_TITLE)) return "strong";
    const parsed = parseLine(row.text);
    if (!parsed) continue;
    if (parsed.explicitQuantity || looksLikeGemReward(row.text)) return "strong";
    weak = true;
  }
  return weak ? "weak" : "none";
}

function pollIntervalMs(): number {
  const configured = props.config.pollIntervalMs;
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return Math.min(Math.max(configured, MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
}

/** The rate the timer should run at right now - see ACTIVE_POLL_INTERVAL_MS. */
function currentIntervalMs(): number {
  return panelOpen.value ? ACTIVE_POLL_INTERVAL_MS : pollIntervalMs();
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let scanAckTimer: ReturnType<typeof setTimeout> | null = null;
let emptyPollCount = 0;
// Replies carry no request id, so this is how a poll's own reply is told from a
// hotkey press's - see the ocr-text handler for why that distinction is only
// ever used for the acknowledgement message, and therefore why an occasional
// miscount is harmless.
let pendingPolls = 0;

function requestScan() {
  if (!props.config.region) return;
  pendingPolls++;
  Host.sendEvent({
    name: "CLIENT->MAIN::request-ocr",
    payload: {
      target: "expedition-price",
      region: props.config.region,
      // Read fresh each poll, so toggling the setting takes effect on the
      // very next scan rather than needing the widget rebuilt.
      detectRunes: props.config.trackRunes === true,
    },
  });
}

function stopWatching() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pendingPolls = 0;
}

/** Whether the timer should be running right now, given mode and state. */
function shouldWatch(): boolean {
  if (!props.config.region) return false;
  // Continuous mode watches always; hotkey mode only watches while there is
  // something on screen to notice the disappearance of.
  return props.config.continuousScan === true || panelOpen.value;
}

function syncWatching(scanNow: boolean) {
  if (!shouldWatch()) {
    stopWatching();
    return;
  }
  stopWatching();
  // Scanning once immediately keeps the widget from being blind for a whole
  // interval after startup or a settings change. Skipped when re-syncing for a
  // reason that isn't a user action, so the timer isn't perpetually reset.
  if (scanNow) requestScan();
  // Re-read on every sync rather than captured once: syncWatching() is called
  // whenever the panel opens or closes, which is exactly when the rate changes.
  pollTimer = setInterval(requestScan, currentIntervalMs());
}

// Debounced because these values are bound live to settings inputs: the
// interval box updates the config on every keystroke, so typing "3000" would
// otherwise restart the timer four times and fire four immediate OCR scans on
// the way through "3", "30", "300". The region fields have the same shape.
const RESTART_DEBOUNCE_MS = 400;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRestart() {
  if (restartTimer !== null) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    syncWatching(true);
  }, RESTART_DEBOUNCE_MS);
}

watch(
  [
    () => props.config.region,
    () => props.config.pollIntervalMs,
    () => props.config.continuousScan,
  ],
  scheduleRestart,
);

// Not `immediate: true` on the watch above: startup should scan at once (in
// continuous mode) rather than after the debounce.
syncWatching(true);

function closePanel() {
  panelOpen.value = false;
  emptyPollCount = 0;
  rawRows.value = [];
  // The rune layer replies on its own event and is never cleared by the
  // pricing path, so without this a closed panel's last detection would sit
  // here waiting to be joined onto whatever text the NEXT panel produces.
  runeRows.value = [];
  // In hotkey mode this is what stops the timer again: it only ran to notice
  // this moment. In continuous mode shouldWatch() keeps it running.
  syncWatching(false);
}

function flashScanAck() {
  showScanAck.value = true;
  if (scanAckTimer !== null) clearTimeout(scanAckTimer);
  scanAckTimer = setTimeout(() => {
    showScanAck.value = false;
    scanAckTimer = null;
  }, SCAN_ACK_MS);
}

onUnmounted(() => {
  stopWatching();
  if (scanAckTimer !== null) clearTimeout(scanAckTimer);
  if (restartTimer !== null) clearTimeout(restartTimer);
});

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
  /** Every rune in this row, named where possible - empty when the rune layer
   * is off, or when no detected rune row lined up with this text line.
   *
   * Gilding is a property of each rune (`carriesForward`), NOT a single "the
   * caged one" field: a row can carry more than one gilded rune. An earlier
   * version stored one here and silently dropped the rest. */
  runes: ResolvedRune[];
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
    const runes = runesForTextRow(raw);
    out.push({
      quantity: parsed.quantity,
      displayName: parsed.name,
      priceText,
      y: raw.y,
      height: raw.height,
      totalValue,
      valueTier: null, // filled in below, once every row's totalValue is known
      runes,

    });
  }

  assignValueTiers(out);
  return out;
}

// Pairs an OCR text line with the detected rune row it belongs to.
//
// The two layers never talk to each other in main, so they are joined here, by
// vertical position - both report y/height as fractions of the SAME captured
// region, which is what makes this possible without either side knowing about
// the other. A text line belongs to the rune row whose band contains its
// centre; anything that matches nothing simply gets no runes, which is the
// correct outcome when only one layer produced a result for that row.
//
// Identity is then resolved from the row's RAW text (not the price-matching
// `parsed.name`, which has been stripped for a different purpose) against the
// recipe table - see rune-identity.ts.
function runesForTextRow(raw: RawRow): ResolvedRune[] {
  if (!props.config.trackRunes) return [];
  const table = comboTable.value;
  if (!table) return []; // data still loading
  const centre = raw.y + raw.height / 2;
  const match = runeRows.value.find(
    (r) => centre >= r.y && centre <= r.y + r.height && r.cells.length > 0,
  );
  if (!match) return [];
  return resolveRowRunes(table, runeRatings.value, raw.text, match.cells);
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

  // Whose reply is this - our poll's, or a hotkey press's? Main sends no
  // request id to match on, so this counter is the only available answer. It is
  // used for exactly one thing: deciding whether to acknowledge a fruitless
  // MANUAL scan. A miscount (possible if main drops a reply after an OCR
  // error) therefore costs at most one 2-second message, never a wrong price.
  const fromPoll = pendingPolls > 0;
  if (fromPoll) pendingPolls--;

  // Main answered without looking (the game wasn't in the foreground). That is
  // NOT evidence the panel closed, so nothing here may change state - in
  // particular this must not count toward emptyPollCount. Opening the
  // overlay's own settings blurs the game, and treating that as "panel gone"
  // wiped the results the user had opened the settings to look at.
  if (e.skipped) return;

  const signal = panelSignal(newRows);

  // A manual scan is the user asserting "I am looking at the panel right now",
  // which is better evidence than anything in the pixels - so a hotkey press
  // opens on weak evidence too. That deliberately keeps the hotkey path
  // behaving exactly as it always has, even if OCR mangles every quantity
  // prefix on some panel this has never seen. Only the POLL has to be sceptical,
  // because only the poll fires when the user wasn't asking for anything.
  const confirmsPanel =
    signal === "strong" || (signal === "weak" && !fromPoll && !panelOpen.value);

  if (confirmsPanel) {
    emptyPollCount = 0;
    const wasOpen = panelOpen.value;
    panelOpen.value = true;
    rawRows.value = newRows;
    // Real results supersede the acknowledgement immediately.
    showScanAck.value = false;
    // In hotkey mode the timer isn't running yet - this reply is what starts
    // it, so the display can clear itself once the panel closes. (No-op in
    // continuous mode, where it's already running.)
    if (!wasOpen) syncWatching(false);
    return;
  }

  // No confirmation - either nothing parsed, or only stray text did. Two in a
  // row (not one: a stray bad frame must not clear real results) means the
  // panel has most likely closed.
  //
  // rawRows is deliberately NOT updated here. During the grace period the
  // display holds its last good state instead of flickering, and - the reason
  // this matters in practice - world text that drifts into the capture region
  // as the panel closes never gets rendered as a "?" row on the way out.
  if (panelOpen.value) {
    if (++emptyPollCount >= CLOSE_AFTER_EMPTY_POLLS) closePanel();
    return;
  }

  // Panel already closed and still nothing there. Silence is right for a poll
  // (that's most of a play session), but a hotkey press the user just made
  // deserves an answer.
  if (!fromPoll) flashScanAck();
});

Host.onEvent("MAIN->CLIENT::expedition-runes", (e) => {
  if (e.target !== "expedition-price") return;
  // A late reply arriving after the layer was switched off must not repopulate
  // the display - the request that produced it was already in flight.
  if (!props.config.trackRunes) return;
  runeRows.value = e.rows;
});

// Rebuilt from getFlatPriceEntries()'s current snapshot each time rawRows changes,
// rather than cached in its own computed - getFlatPriceEntries() reads a plain,
// non-reactive variable inside usePoeninja(), so a separately-cached index would
// have no reactive dependency to invalidate on and could get stuck on stale (or
// empty, pre-fetch) data forever. Tying it to `rawRows` instead means it's rebuilt
// exactly when there's new OCR output to price anyway - cheap, for ~100 entries.
const rows = computed<DisplayRow[]>(() => buildRows(rawRows.value));
</script>
