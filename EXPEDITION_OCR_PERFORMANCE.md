# Expedition OCR — performance review

Status: **baseline measured, the three fixes in §3 landed, the rest is open.**
Written as a starting context for a later session so the measurements and the
dead ends do not have to be rediscovered.

**Scope caveat added 2026-09-17:** everything measured here predates the
succession-rune layer. When `trackRunes` is on, each scan additionally runs
OpenCV cell and gilding detection (`main/src/vision/expedition-runes/`) that is
absent from the flow in §2 and from the 300 ms figure in §1. That cost has never
been measured. The numbers below remain valid for the default configuration,
where the rune layer is off and does no work at all.

Read this before `EXPEDITION_CHECK.md` if performance is the task; read that one
instead if the task is behaviour.

---

## 1. The headline number

A single scan costs roughly **300 ms of wall time, of which only ~18 ms is the
OCR engine.**

That ratio is the whole point of this document. `Windows.Media.Ocr` is not the
bottleneck and is unlikely ever to be. The other ~94% is marshalling: starting a
process, initialising WinRT, encoding and writing a PNG, reading JSON back.

Measured by running the bridge script five times against a real 5-row panel
capture: wall 307/293/295/292/312 ms, engine 18/18/18/19/18 ms.

**What is NOT yet measured, and should be step one:** that 300 ms is the
PowerShell invocation seen from outside. The Electron-side work before it —
cropping the screenshot, `nativeImage.createFromBitmap`, `toPNG()`, writing to
the temp directory — is *additional* and has never been timed separately.
`ocrExpeditionPanel()` reports one combined `elapsed` for everything, so the
split between "Electron prepares the image" and "PowerShell reads it" is
currently unknown. Instrument that before optimising, or you may spend the
effort on the smaller half.

---

## 2. The flow, and where the time can go

```
hotkey / poll tick
  └─ Shortcuts.ts: runOcrAndReply()
       ├─ GameWindow.screenshot()          full window, BGRA, every scan
       ├─ WindowsOcr.ts: ocrExpeditionPanel()
       │    ├─ cropImageFraction()          crop to the user's region
       │    ├─ nativeImage.createFromBitmap → toPNG()
       │    ├─ fs.writeFile(os.tmpdir()/ee2-winocr-<uuid>.png)
       │    ├─ spawn powershell -File windows-ocr-recognize.ps1
       │    │     └─ WinRT init → decode PNG → OcrEngine.RecognizeAsync  ← the 18 ms
       │    └─ JSON.parse(stdout) → lines[] with y/height fractions
       └─ MAIN->CLIENT::ocr-text  → WidgetExpedition.vue
```

Files, in the order they matter:

| File | What to look at |
| --- | --- |
| `main/src/vision/WindowsOcr.ts` | `ocrExpeditionPanel()` — crop, encode, temp file, spawn, parse. **Most of the addressable cost is in this one function.** |
| `main/src/vision/windows-ocr-recognize.ps1` | The bridge. Its `elapsedMs` covers `RecognizeAsync` only, not startup. |
| `main/src/shortcuts/Shortcuts.ts` | `runOcrAndReply()`, and the `CLIENT->MAIN::request-ocr` handler that skips scans when the game is not foreground. |
| `renderer/src/web/expedition-check/WidgetExpedition.vue` | Poll lifecycle: `shouldWatch()`, `syncWatching()`, `requestScan()`, the in-flight guard, and the `ocr-text` handler. |
| `main/src/windowing/GameWindow.ts` | `screenshot()` → `OverlayController.screenshot()`. |

Current timing constants live at the top of the polling section in
`WidgetExpedition.vue`: 700 ms while the panel is open, user-set interval
(default 3000 ms, clamped 1000–30000) while watching for it, 2 unconfirmed
scans to decide the panel closed, 5000 ms in-flight timeout.

---

## 3. Already done — do not redo

- **One scan at a time.** The poll timer used to fire regardless of whether the
  previous scan had answered, so a slow scan meant a second screenshot and
  subprocess piled on top. A tick arriving while one is outstanding is now
  skipped, with a 5 s timeout so a lost reply cannot latch the guard. Only
  polling is throttled; a hotkey press is handled in main and always scans.
- **Zero idle cost in the default mode.** With automatic watching off, no timer
  exists while the panel is closed. There is nothing left to tune there.
- **No scan while the game is not foreground** (automatic watching only). The
  request is answered `skipped`, without screenshot or OCR.

---

## 4. Options, ranked

### A. Skip OCR when the region's pixels have not changed — *recommended first*

Hash the cropped buffer; if it matches the previous scan, reuse the previous
result and skip everything downstream.

The panel is **static while it is open**, which is exactly when polling is
hardest (700 ms). This should eliminate almost all OCR work in the expensive
case. Self-contained in `WindowsOcr.ts`, no new dependencies, and it fails safe
— a hash miss just does the normal thing.

Still pays for the screenshot and the crop. Watch for: hover highlights and
animated panel effects changing pixels every frame, which would defeat it. Test
that before committing to it — if the panel is never bit-identical between
frames, this option is worthless and the measurement is the cheap way to find
out.

### B. Keep one PowerShell process alive

Feed it image paths (or bytes) over stdin instead of spawning per scan. Removes
process startup and WinRT init, which is most of the 300 ms — plausibly down to
~30–50 ms per call.

Bigger per-call win than A, and more work: a resident subprocess needs crash
restart, shutdown on app exit, and a framed request/response protocol. Pairs
naturally with C.

### C. Stop writing a PNG to the temp directory

Pipe the bitmap over stdin instead. Removes the PNG encode, the disk write, the
unlink, and antivirus inspecting a newly created file on every scan.

Two sub-options worth measuring separately:
- **Send Gray8 instead of BGRA.** The OCR engine accepts Gray8, and text
  recognition does not need colour. Roughly a quarter of the bytes to encode,
  write, and decode. (The rune layer needs colour, but it runs on the worker
  thread from the same screenshot and does not use this path.)
- **Send an uncompressed format.** PNG compression is pure overhead when the
  consumer is a local process a millisecond away.

### D. Screenshot only the region — **blocked, do not investigate again**

`electron-overlay-window` exposes `screenshot(): Buffer` with **no arguments**
(checked in its type definitions). There is no way to capture a sub-region, so
the full window is captured and then cropped on every scan. This matters most at
4K. Closed off without patching or replacing that library.

### E. Lower the active poll rate

A straight trade-off against responsiveness: results would clear more slowly
after closing the panel, and prices refresh less often while it is open. 700 ms
was chosen to make the display clear 1.5–2 s after the panel goes. Cheapest
possible change, but it buys performance by removing behaviour rather than cost.

---

## 5. Working efficiently in this repo

Context is the scarce resource here. What actually helps:

- **Locate with `Grep`/`Glob`, then read only the range you need.** Read a file
  end to end only when porting or refactoring it. `WidgetExpedition.vue` is
  ~800 lines and rarely needs to be read whole for a performance question — the
  polling section and the `ocr-text` handler are enough.
- **Never read these**: `renderer/public/data/**/items.ndjson` and
  `dataParser/output/**` (megabytes of generated game data),
  `renderer/public/data/expedition/rune-combinations.json` (a 320-line recipe
  table you almost certainly do not need), any `node_modules` or lockfile.
- **Edit with `Edit`/`Write`, not `sed`.** Editing a file through the shell
  makes the harness re-inject the whole file into context.
- **Measure the bridge directly** instead of launching the app — it is a
  standalone script and needs only an image:

  ```
  powershell -NoProfile -ExecutionPolicy Bypass \
    -File main/src/vision/windows-ocr-recognize.ps1 <panel.png>
  ```

  It prints one JSON object including `elapsedMs` (engine only) and per-word
  bounding boxes. Time the whole invocation externally to get the wall figure.
  Real panel captures live in the `ocr-playground` sandbox under
  `fixtures/images/` — that project is not part of this repo and is not needed
  for anything except supplying test images.

- **Verify once, at the end**: `npx vue-tsc --noEmit`, `npx eslint --ext
  .ts,.vue src`, `npx vitest run` in `renderer/`, and `npx tsc --noEmit` in
  `main/`. Do not re-run the suite after every edit.
- **`renderer/specs/web/client-log.test.ts` has one failing test** —
  "Should parse full campaign client log". It is upstream's, last touched in
  `d26f74f9` by the upstream author, and neither it nor its source has been
  touched by any Expedition work. Expect `580 passed | 1 failed`. Do not chase
  it and do not report it as a regression.

---

## 6. Constraints that outrank performance

- **The price check must keep working, identically.** It is the feature that
  actually works; a faster scan that changes its timing or accuracy is a
  regression. Rune tracking and automatic watching are both off by default and
  must stay that way.
- **Measure, don't assert.** This work has repeatedly punished confident
  guesses — an image-resolution diagnosis, a "gold hue" range, and a
  browser-cache theory were all wrong and all retracted. Reproduce a
  slowdown before claiming a fix for it.
- **Say what was not verified.** "Typechecks and tests pass" is not "faster in
  game". Timings from fixture images are not timings from a live 4K client.
