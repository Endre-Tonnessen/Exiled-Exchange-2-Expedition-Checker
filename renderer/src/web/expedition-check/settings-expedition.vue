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

    <UiCheckbox v-model="showRawOcr">{{ t(":show_raw_ocr") }}</UiCheckbox>
  </div>

  <!-- Teleported to <body>: needs to sit over the actual game, not inside the
       settings dialog's own layout. Bound to `configWidget.region` (the settings
       clone), the same object "Save" commits - so dragging and Save can never race
       each other the way they would if this wrote to the live widget directly. -->
  <Teleport to="body">
    <div
      class="fixed cursor-move"
      style="z-index: 9999; border: 2px solid #22c55e; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45)"
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
import { computed } from "vue";
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

const showRawOcr = configModelValue(() => props.configWidget, "showRawOcr");

// Percentages resolve against the fixed-positioned element's viewport directly, so no
// pixel math against window.innerWidth/innerHeight is needed here.
const regionPreviewStyle = computed(() => {
  const region = props.configWidget.region!;
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
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

function startDrag(mode: DragMode, e: MouseEvent) {
  const region = props.configWidget.region;
  if (!region) return;
  e.preventDefault();

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
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
</script>
