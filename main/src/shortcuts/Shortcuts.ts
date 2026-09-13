import { screen, globalShortcut } from "electron";
import { uIOhook, UiohookKey, UiohookWheelEvent } from "uiohook-napi";
import {
  isModKey,
  KeyToElectron,
  mergeTwoHotkeys,
} from "../../../ipc/KeyToCode";
import { typeInChat, stashSearch } from "./text-box";
import { WidgetAreaTracker } from "../windowing/WidgetAreaTracker";
import { HostClipboard } from "./HostClipboard";
import { OcrWorker } from "../vision/link-main";
import type { ShortcutAction } from "../../../ipc/types";
import type { Logger } from "../RemoteLogger";
import type { OverlayWindow } from "../windowing/OverlayWindow";
import type { GameWindow } from "../windowing/GameWindow";
import type { GameConfig } from "../host-files/GameConfig";
import type { ServerEvents } from "../server";

type UiohookKeyT = keyof typeof UiohookKey;
const UiohookToName = Object.fromEntries(
  Object.entries(UiohookKey).map(([k, v]) => [v, k]),
);

export class Shortcuts {
  private actions: ShortcutAction[] = [];
  private stashScroll = false;
  private logKeys = false;
  private areaTracker: WidgetAreaTracker;
  private clipboard: HostClipboard;

  static async create(
    logger: Logger,
    overlay: OverlayWindow,
    poeWindow: GameWindow,
    gameConfig: GameConfig,
    server: ServerEvents,
  ) {
    const ocrWorker = await OcrWorker.create();
    const shortcuts = new Shortcuts(
      logger,
      overlay,
      poeWindow,
      gameConfig,
      server,
      ocrWorker,
    );
    return shortcuts;
  }

  private constructor(
    private logger: Logger,
    private overlay: OverlayWindow,
    private poeWindow: GameWindow,
    private gameConfig: GameConfig,
    private server: ServerEvents,
    private ocrWorker: OcrWorker,
  ) {
    this.areaTracker = new WidgetAreaTracker(server, overlay);
    this.clipboard = new HostClipboard(logger);

    this.poeWindow.on("active-change", (isActive) => {
      process.nextTick(() => {
        if (isActive === this.poeWindow.isActive) {
          if (isActive) {
            this.register();
          } else {
            this.unregister();
          }
        }
      });
    });

    this.server.onEventAnyClient("CLIENT->MAIN::user-action", (e) => {
      if (e.action === "stash-search") {
        stashSearch(e.text, this.clipboard, this.overlay);
      }
    });

    // Continuous-polling counterpart to the hotkey-driven "ocr-text" action below -
    // same underlying scan, just requested by the renderer on a timer instead of a
    // global hotkey press.
    this.server.onEventAnyClient("CLIENT->MAIN::request-ocr", (e) => {
      this.runOcrAndReply(e.target, e.region, Date.now());
    });

    uIOhook.on("keydown", (e) => {
      if (!this.logKeys) return;
      const pressed = eventToString(e);
      this.logger.write(`debug [Shortcuts] Keydown ${pressed}`);
    });
    uIOhook.on("keyup", (e) => {
      if (!this.logKeys) return;
      this.logger.write(
        `debug [Shortcuts] Keyup ${
          UiohookToName[e.keycode] || "not_supported_key"
        }`,
      );
    });

    uIOhook.on("wheel", (e) => {
      if (!e.ctrlKey || !this.poeWindow.isActive || !this.stashScroll) return;

      if (!isStashArea(e, this.poeWindow)) {
        if (e.rotation > 0) {
          uIOhook.keyTap(UiohookKey.ArrowRight);
        } else if (e.rotation < 0) {
          uIOhook.keyTap(UiohookKey.ArrowLeft);
        }
      }
    });
  }

  updateDelay(delay: number) {
    this.clipboard.updateDelay(delay);
  }

  updateActions(
    actions: ShortcutAction[],
    stashScroll: boolean,
    logKeys: boolean,
    restoreClipboard: boolean,
    language: string,
  ) {
    this.stashScroll = stashScroll;
    this.logKeys = logKeys;
    this.clipboard.updateOptions(restoreClipboard);
    this.ocrWorker.updateOptions(language);

    const copyItemShortcut = mergeTwoHotkeys(
      "Ctrl + C",
      this.gameConfig.showModsKey,
    );
    if (copyItemShortcut !== "Ctrl + C") {
      actions.push({
        shortcut: copyItemShortcut,
        action: { type: "test-only" },
      });
    }

    const allShortcuts = new Set([
      "Ctrl + C",
      "Ctrl + V",
      "Ctrl + A",
      "Ctrl + F",
      "Ctrl + Enter",
      "Home",
      "Delete",
      "Enter",
      "ArrowUp",
      "ArrowRight",
      "ArrowLeft",
      copyItemShortcut,
    ]);

    for (const action of actions) {
      if (
        allShortcuts.has(action.shortcut) &&
        action.action.type !== "test-only"
      ) {
        this.logger.write(
          `error [Shortcuts] Hotkey "${action.shortcut}" reserved by the game will not be registered.`,
        );
      }
    }
    actions = actions.filter((action) => !allShortcuts.has(action.shortcut));

    const duplicates = new Set<string>();
    for (const action of actions) {
      if (allShortcuts.has(action.shortcut)) {
        this.logger.write(
          `error [Shortcuts] It is not possible to use the same hotkey "${action.shortcut}" for multiple actions.`,
        );
        duplicates.add(action.shortcut);
      } else {
        allShortcuts.add(action.shortcut);
      }
    }
    this.actions = actions.filter(
      (action) =>
        !duplicates.has(action.shortcut) ||
        action.action.type === "toggle-overlay",
    );

    const expeditionActions = this.actions.filter(
      (a) => a.action.type === "ocr-text" && a.action.target === "expedition-price",
    );
    this.logger.write(
      `debug [Shortcuts] updateActions: ${this.actions.length} action(s) registered; expedition-price: ${
        expeditionActions.length === 0
          ? "none"
          : expeditionActions
              .map((a) => `"${a.shortcut}" region=${JSON.stringify((a.action as { region?: unknown }).region)}`)
              .join(", ")
      }`,
    );
    // `register()` is otherwise only called from the "active-change" listener above -
    // if the game was already active *before* this config update (e.g. you add a
    // widget/hotkey without ever alt-tabbing away and back), nothing would otherwise
    // ever re-register with the OS to pick up the new action list. unregister() first
    // so a since-removed/changed hotkey doesn't stay stuck registered to its old action.
    if (this.poeWindow.isActive) {
      this.unregister();
      this.register();
    }
  }

  private register() {
    for (const entry of this.actions) {
      const isOk = globalShortcut.register(
        shortcutToElectron(entry.shortcut),
        () => {
          if (this.logKeys) {
            this.logger.write(
              `debug [Shortcuts] Action type: ${entry.action.type}`,
            );
          }

          if (entry.keepModKeys) {
            const nonModKey = entry.shortcut
              .split(" + ")
              .filter((key) => !isModKey(key))[0];
            uIOhook.keyToggle(UiohookKey[nonModKey as UiohookKeyT], "up");
          } else {
            entry.shortcut
              .split(" + ")
              .reverse()
              .forEach((key) => {
                uIOhook.keyToggle(UiohookKey[key as UiohookKeyT], "up");
              });
          }

          if (entry.action.type === "toggle-overlay") {
            this.areaTracker.removeListeners();
            this.overlay.toggleActiveState();
          } else if (entry.action.type === "paste-in-chat") {
            typeInChat(entry.action.text, entry.action.send, this.clipboard);
          } else if (entry.action.type === "trigger-event") {
            this.server.sendEventTo("broadcast", {
              name: "MAIN->CLIENT::widget-action",
              payload: { target: entry.action.target },
            });
          } else if (entry.action.type === "stash-search") {
            stashSearch(entry.action.text, this.clipboard, this.overlay);
          } else if (entry.action.type === "copy-item") {
            const { action } = entry;

            const pressPosition = screen.getCursorScreenPoint();

            this.clipboard
              .readItemText()
              .then((clipboard) => {
                this.areaTracker.removeListeners();
                this.server.sendEventTo("last-active", {
                  name: "MAIN->CLIENT::item-text",
                  payload: {
                    target: action.target,
                    clipboard,
                    position: pressPosition,
                    focusOverlay: Boolean(action.focusOverlay),
                  },
                });
                if (action.focusOverlay && this.overlay.wasUsedRecently) {
                  this.overlay.assertOverlayActive();
                }
              })
              .catch(() => {});

            pressKeysToCopyItemText(
              entry.keepModKeys
                ? entry.shortcut.split(" + ").filter((key) => isModKey(key))
                : undefined,
              this.gameConfig.showModsKey,
            );
          } else if (
            entry.action.type === "ocr-text" &&
            entry.action.target === "heist-gems"
          ) {
            if (process.platform !== "win32") return;

            const { action } = entry;
            const pressTime = Date.now();
            const imageData = this.poeWindow.screenshot();
            this.ocrWorker
              .findHeistGems({
                width: this.poeWindow.bounds.width,
                height: this.poeWindow.bounds.height,
                data: imageData,
              })
              .then((result) => {
                this.server.sendEventTo("last-active", {
                  name: "MAIN->CLIENT::ocr-text",
                  payload: {
                    target: action.target,
                    pressTime,
                    ocrTime: result.elapsed,
                    paragraphs: result.recognized.map((p) => p.text),
                  },
                });
              })
              .catch(() => {});
          } else if (
            entry.action.type === "ocr-text" &&
            entry.action.target === "expedition-price"
          ) {
            this.logger.write(
              `debug [Shortcuts] expedition-price hotkey "${entry.shortcut}" pressed; region=${JSON.stringify(entry.action.region)}`,
            );
            if (!entry.action.region) {
              this.logger.write(
                `error [Shortcuts] expedition-price hotkey pressed but no region is set - configure a capture region in the widget's settings first.`,
              );
              return;
            }
            this.runOcrAndReply(entry.action.target, entry.action.region, Date.now());
          }
        },
      );

      if (!isOk) {
        this.logger.write(
          `error [Shortcuts] Failed to register a shortcut "${entry.shortcut}". It is already registered by another application.`,
        );
      }

      if (entry.action.type === "test-only") {
        globalShortcut.unregister(shortcutToElectron(entry.shortcut));
      }
    }
  }

  private unregister() {
    globalShortcut.unregisterAll();
  }

  // Shared by the hotkey-driven "ocr-text" action and the renderer-initiated
  // "request-ocr" event (continuous-polling widgets) - both just want a screenshot of
  // a calibrated region OCR'd and the raw text lines sent back. Never throws: a bad
  // frame or an out-of-range region should degrade to "no result", not crash main -
  // but failures are logged (visible in Settings -> Debug) rather than swallowed
  // silently, since a silent no-op is indistinguishable from "nothing was wrong".
  private runOcrAndReply(
    target: string,
    region: { x: number; y: number; width: number; height: number },
    pressTime: number,
  ) {
    if (process.platform !== "win32") {
      this.logger.write(
        `error [Shortcuts] expedition OCR requires Windows (platform: ${process.platform}).`,
      );
      return;
    }

    try {
      const imageData = this.poeWindow.screenshot();
      this.ocrWorker
        .ocrExpeditionPanel(
          {
            width: this.poeWindow.bounds.width,
            height: this.poeWindow.bounds.height,
            data: imageData,
          },
          region,
        )
        .then((result) => {
          if (this.logKeys) {
            this.logger.write(
              `debug [Shortcuts] expedition OCR (${target}): ${result.lines.length} line(s) in ${result.elapsed.toFixed(0)}ms`,
            );
          }
          this.server.sendEventTo("last-active", {
            name: "MAIN->CLIENT::ocr-text",
            payload: {
              target,
              pressTime,
              ocrTime: result.elapsed,
              paragraphs: result.lines,
            },
          });
        })
        .catch((e) => {
          this.logger.write(`error [Shortcuts] expedition OCR failed: ${e}`);
        });
    } catch (e) {
      this.logger.write(
        `error [Shortcuts] expedition OCR screenshot failed: ${e}`,
      );
    }
  }
}

function pressKeysToCopyItemText(
  pressedModKeys: string[] = [],
  showModsKey: string,
) {
  let keys = mergeTwoHotkeys("Ctrl + C", showModsKey).split(" + ");
  keys = keys.filter((key) => key !== "C");
  if (process.platform !== "darwin") {
    // On non-Mac platforms, don't toggle keys that are already being pressed.
    //
    // For unknown reasons, we need to toggle pressed keys on Mac for advanced
    // mod descriptions to be copied. You can test this by setting the shortcut
    // to "Alt + any letter". They'll work with this line, but not if it's
    // commented out.
    keys = keys.filter((key) => !pressedModKeys.includes(key));
  }

  for (const key of keys) {
    uIOhook.keyToggle(UiohookKey[key as UiohookKeyT], "down");
  }

  // finally press `C` to copy text
  uIOhook.keyTap(UiohookKey.C);

  // Timeout to enforce release of keys
  // Game was dropping the release inputs for some reason
  setTimeout(() => {
    keys.reverse();
    for (const key of keys) {
      uIOhook.keyToggle(UiohookKey[key as UiohookKeyT], "up");
    }
  }, 10);
}

function isStashArea(mouse: UiohookWheelEvent, poeWindow: GameWindow): boolean {
  if (
    !poeWindow.bounds ||
    mouse.x > poeWindow.bounds.x + poeWindow.uiSidebarWidth
  )
    return false;

  return (
    mouse.y > poeWindow.bounds.y + (poeWindow.bounds.height * 154) / 1600 &&
    mouse.y < poeWindow.bounds.y + (poeWindow.bounds.height * 1192) / 1600
  );
}

function eventToString(e: {
  keycode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  const { ctrlKey, shiftKey, altKey } = e;

  let code = UiohookToName[e.keycode];
  if (!code) return "not_supported_key";

  if (code === "Shift" || code === "Alt" || code === "Ctrl") return code;

  if (ctrlKey && shiftKey && altKey) code = `Ctrl + Shift + Alt + ${code}`;
  else if (shiftKey && altKey) code = `Shift + Alt + ${code}`;
  else if (ctrlKey && shiftKey) code = `Ctrl + Shift + ${code}`;
  else if (ctrlKey && altKey) code = `Ctrl + Alt + ${code}`;
  else if (altKey) code = `Alt + ${code}`;
  else if (ctrlKey) code = `Ctrl + ${code}`;
  else if (shiftKey) code = `Shift + ${code}`;

  return code;
}

function shortcutToElectron(shortcut: string) {
  return shortcut
    .split(" + ")
    .map((k) => KeyToElectron[k as keyof typeof KeyToElectron])
    .join("+");
}
