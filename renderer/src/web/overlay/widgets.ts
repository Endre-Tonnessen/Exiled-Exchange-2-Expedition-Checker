export interface Widget {
  wmId: number;
  wmType: string;
  wmTitle: string;
  wmWants: "show" | "hide";
  wmZorder: number | "exclusive" | null;
  wmFlags: Array<WellKnownFlag | string>;
}

export interface WidgetSpec {
  type: string;
  instances: "single" | "multi";
  trNameKey?: string;
  initInstance?: () => Widget;
  defaultInstances?: () => Widget[];
}

export type WellKnownFlag =
  | "uninitialized"
  | "menu::skip"
  | "has-browser"
  | "invisible-on-blur"
  | "hide-on-blur"
  | "hide-on-focus"
  | "ignore-ui-visibility";

export interface Anchor {
  pos: string;
  x: number;
  y: number;
}

export interface WidgetMenu extends Widget {
  anchor: Anchor;
  alwaysShow: boolean;
}

export interface PriceCheckWidget extends Widget {
  hotkey: string | null;
  hotkeyHold: string;
  hotkeyLocked: string | null;
  showSeller: false | "account" | "ign";
  searchStatRange: number;
  showRateLimitState: boolean;
  apiLatencySeconds: number;
  collapseListings: "api" | "app";
  smartInitialSearch: boolean;
  lockedInitialSearch: boolean;
  activateStockFilter: boolean;
  showCursor: boolean;
  requestPricePrediction: boolean;
  builtinBrowser: boolean;
  rememberCurrency: boolean;
  defaultAllSelected: boolean;
  itemHoverTooltip: "off" | "keybind" | "always";
  alwaysShowTier: boolean;
  coreCurrency: "exalted" | "chaos";
  currencyVolume: "none" | "value" | "item" | "both";
  rememberListingType: boolean;
  initialDelay: number;
  savedAugments: {
    [key: string]: Array<string | null>;
  };
}

export interface StopwatchWidget extends Widget {
  anchor: Anchor;
  toggleKey: string | null;
  resetKey: string | null;
}

export interface DelveGridWidget extends Widget {
  toggleKey: string | null;
}

export interface ExpeditionCaptureRegion {
  /** all fields are fractions (0..1) of the game window, not pixels - see cropImageFraction */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExpeditionWidget extends Widget {
  anchor: Anchor;
  mode: "hotkey" | "continuous";
  hotkey: string | null;
  region: ExpeditionCaptureRegion | null;
  pollIntervalMs: number;
  /** shows the unprocessed OCR text lines alongside the parsed rows, for diagnosing
   * new/changed panels or matching issues without instrumenting code */
  showRawOcr: boolean;
  /** colors each resolved price by its rank among the currently-visible rows
   * (highest = green, lowest = red, anything between = yellow) - unresolved ("?")
   * rows are never colored by this, regardless of setting */
  colorCodeValues: boolean;
  /** lets the name grow the widget wide enough to show in full instead of
   * truncating, so what OCR actually recognized is always checkable - on by
   * default; turn off for a more compact widget once names aren't needed */
  uncapNameWidth: boolean;
  /** Master switch for the succession-rune layer: which reward row carries the
   * more valuable long-term modifier, not just the higher-priced item. OFF by
   * default, and gated at the request itself - with this off, no detection work
   * runs at all and the reward pricing behaves exactly as it did before this
   * feature existed. See EXPEDITION_RUNE_PORT_PLAN.md. */
  trackRunes: boolean;
  /**
   * How much rune detail to show per row.
   * - "summary": one line per row, naming a rune only when it's worth reacting
   *   to. The default, because it's the only mode that cannot make rows overlap
   *   on a panel with many choices - each row stays exactly as tall as it was
   *   before this feature existed.
   * - "caged": one line, naming just the rune in the gilded cage (the only one
   *   that actually propagates). Blank wherever the cage wasn't detected.
   * - "all": every rune in the row, on a second line. The most informative and
   *   the only mode that can overlap on a dense panel.
   */
  runeDisplay: "summary" | "caged" | "all";
}

export interface ImageStripWidget extends Widget {
  anchor: Anchor;
  images: Array<{
    id: number;
    url: string;
  }>;
}

export interface NotepadWidget extends Widget {
  anchor: Anchor;
  notepadBody: string;
  notepadSize: 0 | 1 | 2;
}
