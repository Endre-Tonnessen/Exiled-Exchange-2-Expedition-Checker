# ![Perfect Jewelers Orb](./renderer/public/images/jeweler.png) Exiled Exchange 2 (personal fork)

**This is a personal fork of [Kvan7/Exiled-Exchange-2](https://github.com/Kvan7/Exiled-Exchange-2),
customized for my own use** — notably an added Expedition Price Check widget
(see [EXPEDITION_CHECK.md](./EXPEDITION_CHECK.md)) that OCRs the Path of
Exile 2 Expedition "Runeshape Combinations" reward panel and shows a live
poe.ninja price next to each reward row, right in the game window:

| | | |
| --- | --- | --- |
| ![Expedition Price Check example 1](./docs/reference-images/ExpeditionPriceCheck1.png) | ![Expedition Price Check example 2](./docs/reference-images/ExpeditionPriceCheck2.png) | ![Expedition Price Check example 3](./docs/reference-images/ExpeditionPriceCheck3.png) |

A second, **experimental** layer reads the same capture and names each row's
runes. Selecting a row resolves two things at once: the reward, and the
modifier its *gilded* runes propagate to the remainder of the Expedition
chain. The panel itself indicates only the first. Off by default — see
[Succession runes](#succession-runes-experimental).

**Expedition Price Check is Windows-only** - it reads the panel via Windows'
own OCR engine (`Windows.Media.Ocr`), which has no equivalent on other
platforms. The rest of the app (everything from upstream Exiled Exchange 2)
remains cross-platform; only this one added feature is gated to Windows.

Path of Exile 2 overlay program for price checking items, among many other loved features - forked from [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade).

This fork isn't the official project or distributed anywhere - build it from source (see Development, below). For the actual Exiled Exchange 2 app, the only official sources are <https://kvan7.github.io/Exiled-Exchange-2/download> or <https://github.com/Kvan7/Exiled-Exchange-2/releases>; anywhere else may be malicious.

## Setting up Expedition Price Check

1. In the overlay's widget bar, open the **⋯** menu → **Add widget...** → **Expedition Price Check**.

   ![Add widget menu](./docs/reference-images/ExpeditionSetupStep1.png)

2. Hover the new widget and click **Edit**.

   ![Edit the widget](./docs/reference-images/ExpeditionSetupStep2.png)

3. Drag the green box over the reward text column of the "Runeshape Combinations"
   panel (the default position won't match your resolution/UI scale), confirm or
   change the hotkey (defaults to `Shift + M`), then click **Save**.

   ![Calibrate region, set hotkey, save](./docs/reference-images/ExpeditionSetupStep3.png)

4. In-game, open a Runeshape Combinations panel and press the hotkey - a price should appear next to each recognized row.

### Expedition Price Check settings

All of the following live in the widget's own settings panel (**Edit**, per
step 2 above).

| Setting | Default | What it does |
| --- | --- | --- |
| Hotkey | `Shift + M` | Triggers a single scan of the calibrated region. |
| Region (drag the green box, or type exact x/y/width/height fractions) | calibrated per-user | The area that gets OCR'd on each scan - see step 3 above. |
| Watch for the panel automatically (experimental) | **Off** | Shows the widget on its own whenever the Combinations panel opens, with no keypress. Costs a scan every interval for as long as the game is running - see [Performance](#performance-and-the-ocr-flow) before turning it on. |
| Scan every (seconds) | 3 | With automatic watching on, how often the region is checked for the panel opening. With it off, how often results refresh while the panel is open. Clamped to 1-30s. |
| Color-code prices by rank | On | Colors each resolved price by how it ranks against the *other rows currently on screen* - highest is green, lowest is red, anything in between is yellow. This is relative to the current panel, not a fixed currency cutoff, so it keeps meaning the same thing as prices drift over a league. Example from the first screenshot above: rewards worth 4.2/4.4/8.4/1.2/12 exalted show 12 green, 1.2 red, and the other three yellow. A single resolved row (or every row tied at the same value) shows green. |
| Show full names (uncapped width) | On | Lets the widget grow wide enough to show the full recognized name instead of truncating it, so a misread is easy to spot. Turn off for a more compact widget once you trust the matches and don't need to see the name day-to-day. |
| Show raw OCR text (debug) | Off | Prints every unprocessed recognized line below the parsed rows - for diagnosing a new/changed panel layout or a matching problem without needing to instrument any code. |
| Track succession runes (experimental) | **Off** | Turns on the rune layer described below. While off, no rune analysis runs at all - not "runs and hides the result" - so price checking behaves exactly as it did before the feature existed. |
| Show (rune detail) | Only runes worth reacting to | How much rune detail each row gets. See the table in [Succession runes](#succession-runes-experimental). |

### Performance and the OCR flow

Scanning is not free, so it is worth knowing exactly when it runs.

**One scan** = a full game-window screenshot → crop to your region → encode a
PNG to the temp directory → spawn a PowerShell subprocess → `Windows.Media.Ocr`.
Measured at roughly **300 ms wall time, of which only ~18 ms is the OCR engine
itself**; the rest is process startup and marshalling. Note the screenshot is of
the whole window regardless of how small your region is.

**With automatic watching off (the default):**

| When | What runs |
| --- | --- |
| Idle - playing, panel closed | **Nothing.** No timer exists, so no screenshots and no subprocesses. |
| You press the hotkey | One scan. |
| Panel open | One scan every 700 ms, so prices and runes stay current. |
| You close the panel | Two more scans confirm it is gone (~1.5-2 s), then scanning **stops completely**. |

**With automatic watching on**, the timer instead runs for the whole session:
one scan per interval while the panel is closed, 700 ms while it is open. When
the game is not the foreground window the request is answered without taking a
screenshot or running OCR at all, so being alt-tabbed costs nothing beyond an
idle timer.

Two further details:

- **Only one scan is ever in flight.** If a scan has not answered by the next
  tick, that tick is skipped rather than starting a second subprocess, so a slow
  machine degrades to a slower refresh instead of accumulating a backlog.
- **Rune tracking adds work per scan** (image analysis on the vision worker
  thread) and only when it is switched on.

If you want lower idle cost than the default, there is nothing to tune - it is
already zero. If automatic watching is on and you want it cheaper, raise the
scan interval.

## Succession runes (experimental)

Only **gilded** runes propagate; the remainder of a recipe applies to that
single pick alone. A row may carry more than one gilded rune. The display
encodes this distinction:

- **Filled marker** (red ⚠ / green ★) — a notable rune that *is* gilded, and so
  will propagate.
- **Dimmed marker** — a notable rune that is *not* gilded. Informational only.
- **Gold underline** (two-line modes) — marks each gilded rune.

| Display mode | Height | Purpose |
| --- | --- | --- |
| Only runes worth reacting to *(default)* | 1 line | Dense panels. Names a rune only when one merits attention; the sole mode that cannot overlap. Full list on hover. |
| Gilded runes | 2 lines | The propagation decision alone. Falls back to the full list where nothing was detected as gilded. |
| Every rune in the row | 2 lines | Whole recipes, and verifying the tool's output. Most likely to overlap. |

The settings panel renders a live preview of each mode.

Ratings are stored in `data/expedition/rune-ratings.json` and are intended to
be edited; see that directory's README.

### Limitations

- **Ratings are opinion, not game data.** Six runes are rated from community
  write-ups; the remainder report as *unrated* rather than being guessed at.
  Expect drift between patches.
- **English clients only.** Identification matches reward text against an
  English recipe table; other locales yield `?` throughout. Border and gilding
  detection are unaffected.
- **Generic rewards are unidentifiable.** Many recipes produce "3x Chaos Orb",
  so no rune can be assigned to a position. Reported as `?` — a deliberate
  refusal, since a wrong label would misinform the pick.
- **Gilding detection is unreliable**, and is the principal known weakness. It
  frequently misses gilded cells, and some panels legitimately contain none, so
  an absent underline is ambiguous. Prefer your own reading of the panel.
- **Rows with no detected cells show no runes**, though their price still
  resolves. Usually short rows on a dense panel.
- **Calibrate the region tightly.** A row is recognized only where its height
  falls between 8% and 40% of the region *width*. An over-wide region yields
  zero rune rows while prices continue to resolve normally.
- **Colour pipeline sensitivity.** Borders are classified by hue, so HDR, Night
  Light/f.lux, or an aggressive monitor profile can suppress tier and gilding
  detection. Naming is unaffected.
- Windows-only, and subject to the same calibration as the price check, whose
  screenshot it shares.

<!-- ## Moving from POE1/Awakened PoE Trade

1. Download latest release from [releases](https://github.com/Kvan7/exiled-exchange-2/releases)
2. Run installer
3. Run Exiled Exchange 2
4. Launch PoE2 to generate correct files
5. Quit PoE2 and EE2 after seeing the banner popup that EE2 loaded
6. Copy `apt-data` from `%APPDATA%\awakened-poe-trade` to `%APPDATA%\exiled-exchange-2` to copy your previous settings
  - Resulting directory structure should look like this:
  - `%APPDATA%\exiled-exchange-2\apt-data\`
    - `config.json`
7. Edit `config.json` and change the value of "windowTitle": "Path of Exile" to instead be "Path of Exile 2", otherwise it will open only for poe1
8. Start Exiled Exchange 2 and PoE2 -->

## FAQ

<https://kvan7.github.io/Exiled-Exchange-2/faq>

## Tool showcase

| Gem                                                | Rare                                                 | Unique                                                   | Currency                                                     |
| -------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| ![Gem Check](./docs/reference-images/GemCheck.png) | ![Rare Check](./docs/reference-images/RareCheck.png) | ![Unique Check](./docs/reference-images/UniqueCheck.png) | ![Currency Check](./docs/reference-images/CurrencyCheck.png) |

### Development

Two parts, run in two separate shells (both need to stay running):

```shell
# Shell 1, from the repo root
cd renderer
npm ci
npm run make-index-files
npm run dev
```

```shell
# Shell 2, from the repo root
cd main
npm ci
npm run dev
```

The `main` process launches the actual Electron app window once it's built - the
`renderer` dev server needs to already be running first, since `main` loads the UI
from it (`http://localhost:5173`) rather than from built files in this mode. Editing
`renderer/` hot-reloads; editing `main/` rebuilds and restarts the Electron process
automatically (which resets any in-memory app state, e.g. unsaved widget config).

See [DEVELOPING.md](./DEVELOPING.md) for formatting, production builds, and releasing.

### Running the tests

Each package has its own suite. `npm test` starts **watch** mode; use
`npx vitest run` for a single pass.

```shell
cd renderer && npx vitest run   # parsing, price matching, rune identity
cd main && npx vitest run       # OCR text repair, rune detection against real screenshots
```

Two things to know before reading a result:

- **`renderer/specs/web/client-log.test.ts` fails, and always has.** It's a
  pre-existing upstream failure, unrelated to anything here. Don't chase it.
- **The rune-detection suite measures; it doesn't gate.** It runs the detector
  over real panel screenshots and prints an accuracy table, then fails only if a
  number drops below the recorded baseline. Individual cells being misread is
  normal and expected - this is brittle pixel work, and the numbers exist to show
  progress over time rather than to pass or fail.

```shell
cd main && npx vitest run specs/vision/expedition-runes   # just the accuracy table
```

After genuinely improving detection, re-record the floor:

```shell
cd main && UPDATE_RUNE_BASELINE=1 npx vitest run specs/vision/expedition-runes
```

Adding your own screenshots to the suite is the most useful contribution to it -
[main/specs/fixtures/README.md](./main/specs/fixtures/README.md) has the recipe.
That suite needs OpenCV, which the app downloads on first run; if it's missing,
those tests skip rather than fail.

### Installing dependencies safely

Use `npm ci`, not `npm install`, for routine setup - it installs exactly what
`package-lock.json` already resolved (same versions, same integrity hashes) and
errors out instead of silently re-resolving anything if the lockfile and
`package.json` disagree. Plain `npm install` can still pick up a newer version
within an existing `^`/`~` range in some cases; `npm ci` never does.

Given how often popular packages get compromised via a hijacked maintainer
account (a malicious version published under a trusted name, still semver-valid
so ordinary installs happily accept it), a few more habits are worth keeping:

- **Never run `npm update` or `npm install <pkg>@latest` casually.** Only bump a
  version deliberately, and review the full `package-lock.json` diff afterward -
  a small, intentional bump should produce a small diff; a huge, unexplained
  churn of unrelated transitive dependencies is worth stopping to look at before
  committing (this happened once already in this fork's history from a stray
  `npm install`, caught and reverted before it was committed).
- **Always commit `package-lock.json`, and read its diff like code.** It's the
  thing that actually pins what gets installed - treat an unexpected change to
  it with the same suspicion as an unexpected change to a source file.
- **Consider `--ignore-scripts`** (`npm ci --ignore-scripts`, or `ignore-scripts=true`
  in `.npmrc`) to block install-time lifecycle scripts, which is the actual
  mechanism most recent supply-chain payloads run through. Caveat: some
  dependencies legitimately need their install script to work at all - Electron
  itself downloads its platform binary via one, and native modules like
  `uiohook-napi` compile via one - so this isn't a safe blanket default here
  without testing that `main/` still installs correctly with it on.
- **`npm audit`** catches *known, already-reported* vulnerabilities in your
  current tree - useful, but reactive. It won't catch a malicious version in the
  window between publication and discovery, so it's a supplement to the habits
  above, not a replacement for them.

### Acknowledgments

- [awakened-poe-trade](https://github.com/SnosMe/awakened-poe-trade)
- [libuiohook](https://github.com/kwhat/libuiohook)
- [RePoE](https://github.com/brather1ng/RePoE)
- [poeprices.info](https://www.poeprices.info/)
- [poe.ninja](https://poe.ninja/)

![graph](https://i.imgur.com/MATqhv7.png)
