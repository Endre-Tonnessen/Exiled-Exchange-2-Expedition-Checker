<template>
  <!-- Price first and never truncated (the primary information at a glance);
       name second, smaller and muted, free to truncate - it exists for the edge
       case of checking what OCR actually recognized, not to be read during
       normal play. Price-first also means every price starts at the same
       left-aligned X by construction, so no width computation is needed just to
       keep them lined up. -->
  <div class="flex items-baseline gap-2">
    <span class="shrink-0 text-lg font-semibold" :class="priceClass">{{ row.priceText }}</span>
    <span class="truncate min-w-0 text-sm text-gray-500">{{ row.quantity }}x {{ row.displayName }}</span>
    <!-- Named inline, on the price's own line, so this costs no extra height -
         the thing that lets a panel with many choices stay legible. Sits beside
         the price because that is the number it argues with: a gilded trap
         means "this price is a lure". -->
    <span
      v-for="rune in highlights"
      :key="rune.index"
      class="shrink-0"
      :class="markerClass(rune)"
      :title="runeTitle(rune)"
      >{{ markerText(rune) }}</span
    >
  </div>
  <!-- Full rune list, second line - only in the detail modes. This is what
       makes rows two lines tall, which is why "summary" omits it entirely
       rather than trying to shrink it. Gilded runes are underlined in gold:
       those are the slots that propagate, and they are what the whole feature
       exists for. -->
  <div
    v-if="mode !== 'summary' && row.runes.length"
    class="flex items-baseline gap-1.5 text-xs leading-tight"
  >
    <span
      v-for="rune in listed"
      :key="rune.index"
      :class="runeClass(rune)"
      :title="runeTitle(rune)"
      >{{ runeLabel(rune) }}{{ RATING_MARK[rune.rating] }}</span
    >
  </div>
</template>

<script setup lang="ts">
// One rendered reward row. Deliberately knows nothing about positioning - the
// widget places it absolutely against the game's own rows, the settings preview
// stacks a few of them normally - so both get identical markup from one source.
import { computed } from "vue";
import {
  RATING_MARK,
  markerClass,
  markerText,
  runeClass,
  runeLabel,
  runeTitle,
  rowHighlights,
  runesToShow,
  type RuneDisplayMode,
  type ExpeditionRowData,
} from "./rune-display";

const props = defineProps<{
  row: ExpeditionRowData;
  mode: RuneDisplayMode;
  /** Already-resolved colour for the price, so this component stays free of
   * ranking logic - the widget computes it from the live panel, the preview
   * passes a fixed one. */
  priceClass: string;
}>();

const highlights = computed(() => rowHighlights(props.row.runes));
const listed = computed(() => runesToShow(props.row.runes, props.mode));
</script>
