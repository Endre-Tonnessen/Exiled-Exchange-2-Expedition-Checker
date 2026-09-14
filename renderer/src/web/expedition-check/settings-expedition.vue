<template>
  <div class="flex flex-col gap-4 p-2 max-w-md">
    <HotkeysGeneric :hotkeys="hotkeys" />

    <div class="flex flex-col gap-1">
      <div class="text-gray-500 text-xs">{{ t(":region_notice") }}</div>
      <div class="grid grid-cols-4 gap-2">
        <label class="flex flex-col text-xs text-gray-500">
          x
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            v-model.number="regionX"
            class="bg-gray-900 rounded px-1"
          />
        </label>
        <label class="flex flex-col text-xs text-gray-500">
          y
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            v-model.number="regionY"
            class="bg-gray-900 rounded px-1"
          />
        </label>
        <label class="flex flex-col text-xs text-gray-500">
          width
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            v-model.number="regionWidth"
            class="bg-gray-900 rounded px-1"
          />
        </label>
        <label class="flex flex-col text-xs text-gray-500">
          height
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            v-model.number="regionHeight"
            class="bg-gray-900 rounded px-1"
          />
        </label>
      </div>
    </div>

    <!-- Its own section rather than another checkbox in the list below: this
         one changes how much work the app does while you play, which is a
         different kind of decision from the display options. -->
    <div class="border-t border-gray-700 pt-3 flex flex-col gap-2">
      <UiCheckbox v-model="continuousScan">{{ t(":continuous_scan") }}</UiCheckbox>
      <div class="text-gray-500 text-xs">{{ t(":continuous_scan_notice") }}</div>

      <label class="flex items-center gap-2 text-sm">
        <span>{{ t(":poll_interval") }}</span>
        <input
          type="number"
          step="0.5"
          min="1"
          max="30"
          v-model.number="pollIntervalSeconds"
          class="bg-gray-900 rounded px-1 w-20"
        />
      </label>
      <div class="text-gray-500 text-xs">
        {{ continuousScan ? t(":poll_interval_notice_continuous") : t(":poll_interval_notice_hotkey") }}
      </div>
    </div>

    <UiCheckbox v-model="showRawOcr">{{ t(":show_raw_ocr") }}</UiCheckbox>
    <UiCheckbox v-model="colorCodeValues">{{ t(":color_code_values") }}</UiCheckbox>
    <UiCheckbox v-model="uncapNameWidth">{{ t(":uncap_name_width") }}</UiCheckbox>

    <!-- The rune layer is its own section, not another checkbox in the list
         above: it is a separate feature that happens to share this capture,
         and the settings should say so. Off leaves the price checking exactly
         as it was. -->
    <div class="border-t border-gray-700 pt-3 flex flex-col gap-2">
      <UiCheckbox v-model="trackRunes">{{ t(":track_runes") }}</UiCheckbox>
      <div class="text-gray-500 text-xs">{{ t(":track_runes_notice") }}</div>

      <div v-if="trackRunes" class="flex flex-col gap-1">
        <div class="text-xs text-gray-500">{{ t(":rune_display") }}</div>
        <select v-model="runeDisplay" class="bg-gray-900 rounded px-1 py-0.5 text-sm">
          <option value="summary">{{ t(":rune_display_summary") }}</option>
          <option value="caged">{{ t(":rune_display_caged") }}</option>
          <option value="all">{{ t(":rune_display_all") }}</option>
        </select>

        <!-- Rendered by ExpeditionRow, the same component the widget itself
             uses, against fixed sample rows - so what's previewed here cannot
             drift from what actually appears in game. Only the data is fake. -->
        <div class="mt-1 rounded bg-gray-900 p-2 flex flex-col gap-2">
          <div class="text-xs text-gray-500">{{ t(":rune_preview") }}</div>
          <div
            v-for="(sample, i) in PREVIEW_ROWS"
            :key="i"
            class="whitespace-nowrap overflow-x-auto"
          >
            <ExpeditionRow
              :row="sample.row"
              :mode="runeDisplay"
              :price-class="sample.priceClass"
            />
          </div>
          <div class="text-gray-500 text-xs">{{ t(":rune_preview_legend") }}</div>
        </div>

        <div class="text-gray-500 text-xs">{{ t(":rune_display_notice") }}</div>
        <div class="text-gray-500 text-xs">{{ t(":rune_ratings_notice") }}</div>
      </div>
    </div>
  </div>

  <!-- Teleported to <body>: needs to sit over the actual game, not inside the
       settings dialog's own layout. Bound to `configWidget.region` (the settings
       clone), the same object "Save" commits - so dragging and Save can never race
       each other the way they would if this wrote to the live widget directly. -->
  <Teleport to="body">
    <div
      class="fixed cursor-move"
      style="z-index: 9999; border: 2px solid #22c55e"
      :style="regionPreviewStyle"
      @mousedown="startDrag('move', $event)"
    >
      <div
        class="absolute inset-x-0 top-0 text-center text-xs text-green-400 bg-black/60 py-0.5"
      >
        {{ regionLabel }}
      </div>
      <div
        v-for="corner in corners"
        :key="corner.mode"
        class="absolute w-3 h-3 bg-green-400 border border-black"
        :class="corner.cursor"
        :style="corner.style"
        @mousedown.stop="startDrag(corner.mode, $event)"
      ></div>
    </div>
  </Teleport>
</template>

<script lang="ts">
export default {
  name: "expedition_check.name",
};
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nNs } from "@/web/i18n";
import {
  configProp,
  configModelValue,
  _configModelValue,
} from "../settings/utils.js";
import type { ExpeditionWidget } from "@/web/overlay/widgets";
import { DEFAULT_REGION } from "./region";

import HotkeysGeneric, { HotkeySchema } from "../settings/HotkeysGeneric.vue";
import UiCheckbox from "../ui/UiCheckbox.vue";
import ExpeditionRow from "./ExpeditionRow.vue";
import type { ResolvedRune } from "./rune-value";
import type { ExpeditionRowData } from "./rune-display";

const props = defineProps(configProp<ExpeditionWidget>());
const { t } = useI18nNs("expedition_check");

// Every widget instance gets a real region at creation time (see WidgetExpedition.vue's
// "uninitialized" init), so this should never actually be null here - the fallback is
// just defensive (e.g. a hand-edited config file).
if (!props.configWidget.region) {
  props.configWidget.region = { ...DEFAULT_REGION };
}

const hotkeys = computed<HotkeySchema[]>(() => [
  {
    translationKey: "expedition_check.scan_key",
    config: _configModelValue(props.configWidget, "hotkey"),
  },
]);

function regionField(key: "x" | "y" | "width" | "height") {
  return computed<number>({
    get() {
      return props.configWidget.region![key];
    },
    set(value) {
      props.configWidget.region = { ...props.configWidget.region!, [key]: value };
    },
  });
}

const regionX = regionField("x");
const regionY = regionField("y");
const regionWidth = regionField("width");
const regionHeight = regionField("height");

// Seconds in the UI, milliseconds in the config - "3000" in a box labelled
// "scan every" invites reading it as seconds and setting a 50-minute interval.
// The widget clamps whatever lands here to its own sane range at use time, so
// this only has to be reasonable, not defensive.
const pollIntervalSeconds = computed<number>({
  get() {
    return (props.configWidget.pollIntervalMs ?? 3000) / 1000;
  },
  set(value) {
    if (!Number.isFinite(value)) return;
    props.configWidget.pollIntervalMs = Math.round(value * 1000);
  },
});

const continuousScan = configModelValue(() => props.configWidget, "continuousScan");
const showRawOcr = configModelValue(() => props.configWidget, "showRawOcr");
const colorCodeValues = configModelValue(() => props.configWidget, "colorCodeValues");
const uncapNameWidth = configModelValue(() => props.configWidget, "uncapNameWidth");
const trackRunes = configModelValue(() => props.configWidget, "trackRunes");
const runeDisplay = configModelValue(() => props.configWidget, "runeDisplay");

// Sample rows for the live preview above. Built from real captures so the
// preview shows situations that actually occur, and chosen to cover the three
// cases that are easy to confuse:
//   1. a gilded great rune  -> loudest positive signal
//   2. a gilded trap        -> loudest negative signal, and note it carries a
//                              SECOND gilded rune: a row can have more than one
//   3. a great rune that is NOT gilded -> dimmed, because it will not propagate
// Only the data is fake; the rendering is the widget's own component.
function rune(
  index: number,
  runeId: string | null,
  rating: ResolvedRune["rating"],
  carriesForward = false,
): ResolvedRune {
  return { index, runeId, rating, why: null, carriesForward, tier: "none" };
}

const PREVIEW_ROWS: Array<{ row: ExpeditionRowData; priceClass: string }> = [
  {
    priceClass: "text-red-400",
    row: {
      quantity: 1,
      displayName: "ancient rune of witchcraft",
      priceText: "3.8 exalted",
      runes: [
        rune(0, "arcane", "unrated"),
        rune(1, "bloodletting", "unrated"),
        rune(2, "celestial", "unrated"),
        rune(3, "opulent", "great", true),
      ],
    },
  },
  {
    priceClass: "text-green-400",
    row: {
      quantity: 1,
      displayName: "rune of wisdom",
      priceText: "51 exalted",
      runes: [
        rune(0, "time", "unrated"),
        rune(1, "ward", "unrated"),
        rune(2, "wisdom", "poor", true),
        rune(3, "sky", "unrated"),
        rune(4, "oath", "trap", true),
      ],
    },
  },
  {
    priceClass: "text-yellow-400",
    row: {
      quantity: 1,
      displayName: "rune of reach",
      priceText: "13 exalted",
      runes: [
        rune(0, "arcane", "unrated"),
        rune(1, "momentum", "unrated"),
        rune(2, "opulent", "great"),
        rune(3, "vision", "unrated"),
      ],
    },
  },
];

// Percentages resolve against the fixed-positioned element's viewport directly, so no
// pixel math against window.innerWidth/innerHeight is needed here.
const regionPreviewStyle = computed(() => {
  const region = props.configWidget.region!;
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
    // The 9999px-spread box-shadow trick dims everything outside the box - genuinely
    // useful while dragging (makes the boundary obvious against the game), but
    // darkening the whole screen for as long as this settings tab merely happens to
    // be open (e.g. while looking at an unrelated checkbox) was the actual
    // complaint. Only apply it during an active drag; the green border below is
    // always visible on its own, so the box's position stays checkable at a glance
    // either way.
    boxShadow: isDragging.value ? "0 0 0 9999px rgba(0, 0, 0, 0.45)" : "none",
  };
});

const regionLabel = computed(() => {
  const r = props.configWidget.region!;
  return `x:${r.x.toFixed(2)} y:${r.y.toFixed(2)} w:${r.width.toFixed(2)} h:${r.height.toFixed(2)}`;
});

type DragMode = "move" | "resize-tl" | "resize-tr" | "resize-bl" | "resize-br";

const corners: Array<{
  mode: DragMode;
  cursor: string;
  style: Record<string, string>;
}> = [
  { mode: "resize-tl", cursor: "cursor-nwse-resize", style: { left: "-6px", top: "-6px" } },
  { mode: "resize-tr", cursor: "cursor-nesw-resize", style: { right: "-6px", top: "-6px" } },
  { mode: "resize-bl", cursor: "cursor-nesw-resize", style: { left: "-6px", bottom: "-6px" } },
  { mode: "resize-br", cursor: "cursor-nwse-resize", style: { right: "-6px", bottom: "-6px" } },
];

const MIN_REGION_SIZE = 0.02;

// The dim-everything-else spotlight (see regionOverlayStyle) is only useful
// while actively dragging the box - it needs to stay visible (so the box's
// position is still checkable at a glance) for as long as this settings tab is
// open, but darkening the entire game behind it the whole time, even just to
// glance at an unrelated checkbox, was the actual complaint.
const isDragging = ref(false);

function startDrag(mode: DragMode, e: MouseEvent) {
  const region = props.configWidget.region;
  if (!region) return;
  e.preventDefault();
  isDragging.value = true;

  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const startRegion = { ...region };

  function onMove(ev: MouseEvent) {
    const dx = (ev.clientX - startClientX) / window.innerWidth;
    const dy = (ev.clientY - startClientY) / window.innerHeight;

    let { x, y, width, height } = startRegion;

    if (mode === "move") {
      x = startRegion.x + dx;
      y = startRegion.y + dy;
    } else {
      if (mode === "resize-tl" || mode === "resize-bl") {
        x = startRegion.x + dx;
        width = startRegion.width - dx;
      } else {
        width = startRegion.width + dx;
      }
      if (mode === "resize-tl" || mode === "resize-tr") {
        y = startRegion.y + dy;
        height = startRegion.height - dy;
      } else {
        height = startRegion.height + dy;
      }
    }

    width = Math.min(Math.max(width, MIN_REGION_SIZE), 1);
    height = Math.min(Math.max(height, MIN_REGION_SIZE), 1);
    x = Math.min(Math.max(x, 0), 1 - width);
    y = Math.min(Math.max(y, 0), 1 - height);

    props.configWidget.region = { x, y, width, height };
  }

  function onUp() {
    isDragging.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
</script>
