import type { ExpeditionCaptureRegion } from "@/web/overlay/widgets";

// A real, user-calibrated starting point for a freshly-added widget instance -
// better than an arbitrary guess.
//
// Wider than it used to be: it now starts left of the reward text so the recipe
// GLYPH column is inside the capture, not just the currency/item names. That is
// what the rune layer needs to see, so the default no longer has to be widened
// by hand before rune tracking can work at all.
//
// The extra width is safe for rune row detection, which needs each row's height
// to be 8-40% of the capture region's WIDTH (an over-wide region silently finds
// zero rune rows while prices keep resolving - see CLAUDE.md). At 1920x1080 this
// is ~377px wide and ~539px tall, so a ~77px row sits at ~20% of the width,
// nearer the middle of that band than the old narrower region managed.
//
// The extra width also means OCR now sees the glyph column, which produces junk
// text lines. That was already anticipated: parsing.ts's LEADING_NOISE exists
// for exactly this, and such lines carry no quantity or "Skill Level N:" marker,
// so they read as weak evidence and cannot make the widget think a panel is open.
export const DEFAULT_REGION: ExpeditionCaptureRegion = {
  x: 0.015168641524916843,
  y: 0.13107754279959719,
  width: 0.19652197555031564,
  height: 0.49925478348439073,
};
