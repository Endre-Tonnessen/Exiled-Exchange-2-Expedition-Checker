export interface HostConfig {
  shortcuts: ShortcutAction[];
  restoreClipboard: boolean;
  clientLog: string | null;
  gameConfig: string | null;
  stashScroll: boolean;
  overlayKey: string;
  logKeys: boolean;
  windowTitle: string;
  language: string;
  readClientLog: boolean;
  libraryAlpha: boolean;
  libraryOutputPath: string | null;
  initialDelay: number;
  hideOverlayOnBlur: boolean;
}

export interface ShortcutAction {
  shortcut: string;
  keepModKeys?: true;
  action:
    | {
        type: "copy-item";
        focusOverlay?: boolean;
        target: string;
      }
    | {
        type: "ocr-text";
        target: "heist-gems" | "expedition-price";
        // Capture rectangle as fractions (0..1) of the game window, only meaningful
        // for target "expedition-price" (a user-calibrated, fixed panel location).
        region?: { x: number; y: number; width: number; height: number };
        // Also run rune detection on the same capture. Only meaningful for
        // "expedition-price"; see the same field on IpcRequestOcr.
        detectRunes?: boolean;
      }
    | {
        type: "trigger-event";
        target: string;
      }
    | {
        type: "stash-search";
        text: string;
      }
    | {
        type: "toggle-overlay";
      }
    | {
        type: "paste-in-chat";
        text: string;
        send: boolean;
      }
    | {
        type: "test-only";
      };
}

export type UpdateInfo =
  | {
      state: "initial" | "checking-for-update";
    }
  | {
      state: "update-available";
      version: string;
      noDownloadReason: "not-supported" | "disabled-by-flag" | null;
    }
  | {
      state: "update-downloaded";
      version: string;
    }
  | {
      state: "update-not-available" | "error";
      checkedAt: number;
    };

export interface HostState {
  contents: string | null;
  version: string;
  updater: UpdateInfo;
}

export type IpcEvent =
  // events that have meaning only in Overlay mode:
  | IpcOverlayAttached
  | IpcFocusChange
  | IpcVisibility
  | IpcFocusGame
  | IpcOverlayRenderState
  | IpcHideExclusiveWidget
  | IpcTrackArea
  | IpcRequestOcr
  // events used by any type of Client:
  | IpcSaveConfig
  | IpcUpdaterState
  | IpcGameLog
  | IpcClientIsActive
  | IpcLogEntry
  | IpcHostConfig
  | IpcWidgetAction
  | IpcItemText
  | IpcOcrText
  | IpcExpeditionRunes
  | IpcConfigChanged
  | IpcUserAction
  | IpcWriteToFile
  | IpcReparseLog;

export type IpcEventPayload<
  Name extends IpcEvent["name"],
  T extends IpcEvent = IpcEvent,
> = T extends { name: Name; payload: infer P } ? P : never;

type IpcOverlayAttached = Event<"MAIN->OVERLAY::overlay-attached">;

type IpcFocusChange = Event<
  "MAIN->OVERLAY::focus-change",
  {
    game: boolean;
    overlay: boolean;
    usingHotkey: boolean;
  }
>;

type IpcVisibility = Event<
  "MAIN->OVERLAY::visibility",
  {
    isVisible: boolean;
  }
>;

type IpcFocusGame = Event<"OVERLAY->MAIN::focus-game">;

type IpcOverlayRenderState = Event<
  "OVERLAY->MAIN::render-state",
  {
    shouldShow: boolean;
  }
>;

type IpcHideExclusiveWidget = Event<"MAIN->OVERLAY::hide-exclusive-widget">;

type IpcTrackArea = Event<
  "OVERLAY->MAIN::track-area",
  {
    holdKey: string;
    closeThreshold: number;
    from: { x: number; y: number };
    area: { x: number; y: number; width: number; height: number };
    dpr: number;
  }
>;

// Renderer-initiated, on-demand OCR request (used by continuous-polling widgets, as
// opposed to the hotkey-driven path in `ShortcutAction`'s "ocr-text" action). The main
// process answers with the same "MAIN->CLIENT::ocr-text" event either way.
type IpcRequestOcr = Event<
  "CLIENT->MAIN::request-ocr",
  {
    target: string;
    region: { x: number; y: number; width: number; height: number };
    // Opt in to the rune layer for this request. Off by default and gated HERE,
    // at the request, rather than by hiding results later: when it is unset, no
    // detection work happens at all. That is the feature's stated requirement,
    // not merely an optimisation.
    detectRunes?: boolean;
  }
>;

type IpcHostConfig = Event<"CLIENT->MAIN::update-host-config", HostConfig>;

type IpcClientIsActive = Event<
  "CLIENT->MAIN::used-recently",
  {
    isOverlay: boolean;
  }
>;

type IpcSaveConfig = Event<
  "CLIENT->MAIN::save-config",
  {
    contents: string;
    isTemporary: boolean;
  }
>;

type IpcConfigChanged = Event<
  "MAIN->CLIENT::config-changed",
  {
    contents: string;
  }
>;

type IpcLogEntry = Event<
  "MAIN->CLIENT::log-entry",
  {
    message: string;
  }
>;

type IpcWidgetAction = Event<
  "MAIN->CLIENT::widget-action",
  {
    target: string;
  }
>;

type IpcItemText = Event<
  "MAIN->CLIENT::item-text",
  {
    target: string;
    clipboard: string;
    item?: unknown;
    position: { x: number; y: number };
    focusOverlay: boolean;
  }
>;

type IpcOcrText = Event<
  "MAIN->CLIENT::ocr-text",
  {
    target: string;
    pressTime: number;
    ocrTime: number;
    paragraphs: string[];
    // Per-line vertical position within the captured region, as fractions (0-1)
    // of the region's height. Only meaningful for target "expedition-price" -
    // lets that widget position each price next to its actual row in the game
    // panel instead of in a separate stacked list. Optional so "heist-gems"
    // consumers (which only ever read `paragraphs`) don't need to change.
    rows?: { text: string; y: number; height: number }[];
    /**
     * True when main answered WITHOUT scanning (currently: a polled request
     * that arrived while the game wasn't in the foreground).
     *
     * It exists because "I looked and the panel isn't there" and "I didn't
     * look" are different facts that an empty `rows` cannot tell apart, and a
     * consumer that confuses them throws away good results: the expedition
     * widget treats a genuinely empty read as "panel closed" and clears, which
     * is right - but doing that when the user merely opened the overlay's own
     * settings (which blurs the game) wiped the results they were looking at.
     * A skipped reply means "no new information", so state is left untouched.
     *
     * Still a REPLY, not silence, so a requester's in-flight accounting stays
     * exact: every request gets exactly one answer.
     */
    skipped?: boolean;
  }
>;

// The Expedition RUNE layer's reply - deliberately a separate event from
// "ocr-text" above rather than extra fields on it. The two layers are produced
// by different engines on different threads and arrive at different times, and
// either may be disabled while the other runs; one combined event would force
// them to be sent together and couple exactly what this feature's design keeps
// apart. See EXPEDITION_RUNE_PORT_PLAN.md.
//
// Carries geometry and border classification only - no rune NAMES. Naming a
// rune needs the reward text, which the renderer already has, so it happens
// there (renderer/src/web/expedition-check/rune-identity.ts).
type IpcExpeditionRunes = Event<
  "MAIN->CLIENT::expedition-runes",
  {
    target: string;
    pressTime: number;
    /** milliseconds spent in detection, for the debug log */
    detectTime: number;
    /** All geometry is fractions (0-1) of the CAPTURED REGION, not pixels - same
     * convention as `rows` on "ocr-text", so the renderer can match a text line
     * to a rune row by vertical position without knowing the capture size. */
    rows: Array<{
      y: number;
      height: number;
      cells: Array<{
        index: number;
        x: number;
        width: number;
        y: number;
        height: number;
        /** the rune's OWN frame colour - independent of the cage below */
        tier: "none" | "gold" | "purple" | "blue";
        /** this slot's rune propagates to every later encounter in the chain */
        carriesForward: boolean;
      }>;
    }>;
    /** present only when no rows were found, explaining why */
    diagnostic?: string;
  }
>;

type IpcGameLog = Event<
  "MAIN->CLIENT::game-log",
  {
    lines: string[];
  }
>;

type IpcReparseLog = Event<"CLIENT->MAIN::re-parse-log">;

type IpcUpdaterState = Event<"MAIN->CLIENT::updater-state", UpdateInfo>;

// Hotkeyable actions are defined in `ShortcutAction`.
// Actions below are triggered by user interaction with the UI.
type IpcUserAction = Event<
  "CLIENT->MAIN::user-action",
  | {
      action: "check-for-update" | "update-and-restart" | "quit";
    }
  | {
      action: "stash-search";
      text: string;
    }
>;

type IpcWriteToFile = Event<
  "CLIENT->MAIN::write-data",
  | {
      action: "log-item";
      text: string;
    }
  | {
      action: "session";
      start: boolean;
      name?: string;
      header?: string;
    }
  | {
      action: "client-log-event";
      data: ClientLogEvent;
      close: boolean;
    }
>;

export type ClientLogEvent =
  | GeneralLogEvent
  | LoadZoneEvent
  | LevelUpEvent
  | GameVersionEvent
  | AltTabEvent
  | NpcEvent
  | PlayerDeathEvent
  | PassiveTreeEvent
  | PermanentBonusEvent
  | SkillPointEvent
  | MapNavEvent
  | AfkEvent;

type BaseLogEvent = {
  ts: number;
  ms: number;
};

export type GeneralLogEvent = BaseLogEvent & {
  type: "log" | "game-start" | "login";
};

export type LoadZoneEvent = BaseLogEvent & {
  type: "load-zone";
  zone: string;
  areaLevel: number;
  seed: number;
};

export type LevelUpEvent = BaseLogEvent & {
  type: "level-up";
  charName: string;
  charClass: string;
  level: number;
};

export type GameVersionEvent = BaseLogEvent & {
  type: "game-version";
  version: string;
};

export type AltTabEvent = BaseLogEvent & {
  type: "alt-tab";
  gameFocused: boolean;
};

export type NpcEvent = BaseLogEvent & {
  type: "npc";
  npcName: string;
  message: string;
};

export type PlayerDeathEvent = BaseLogEvent & {
  type: "player-death";
  charName: string;
};

export type PassiveTreeEvent = BaseLogEvent & {
  type: "passive-tree";
  allocate: boolean;
  nodeId: string;
  nodeName: string;
};

export type PermanentBonusEvent = BaseLogEvent & {
  type: "permanent-bonus";
  permanentBonus: string;
  charName: string;
};

export type SkillPointEvent = BaseLogEvent & {
  type: "skill-point";
  points: number;
  pointType:
    | "passive"
    | "weapon-set"
    | "atlas"
    // all atlas sub trees
    | "map-boss"
    | "arbiter-boss"
    | "abyss"
    | "ritual"
    | "delirium"
    | "expedition"
    | "breach";
};

export type MapNavEvent = BaseLogEvent & {
  type: "map-nav";
  mapName: string;
};

export type AfkEvent = BaseLogEvent & {
  type: "afk";
  isAfk: boolean;
};

interface Event<TName extends string, TPayload = undefined> {
  name: TName;
  payload: TPayload;
}
