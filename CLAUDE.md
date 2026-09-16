# Exiled Exchange 2 (personal fork)

PoE2 overlay, forked from Kvan7/Exiled-Exchange-2 (itself from Awakened PoE
Trade). **This is the live environment** — the one actually played with. Most of
the tree is upstream code; the added work is the Expedition features below.

## Layout and commands

An Electron app in two npm packages, `main/` (node/Electron) and `renderer/`
(Vue 3 + Tailwind). No root package.json — run commands inside a package.

```shell
# renderer
cd renderer && npx vue-tsc --noEmit        # typecheck
cd renderer && npx vitest run              # tests
cd renderer && npm run lint

# main
cd main && npx tsc --noEmit                # typecheck (covers specs/ too)
cd main && npx vitest run                  # tests
cd main && node build/script.mjs --prod    # bundle (incl. the vision worker)
cd main && npm run lint
```

`npm test` in either package starts **watch** mode — use `npx vitest run` for a
one-shot. The rune-detection suite prints an accuracy table and fails only on a
drop; see `main/specs/fixtures/README.md`.

Running the app needs two shells that both stay up — `renderer && npm run dev`
first, then `main && npm run dev` (main loads the UI from localhost:5173). See
README "Development".

**`renderer/specs/web/client-log.test.ts` has one pre-existing failure**,
unrelated to the Expedition work. Verified against a clean parent commit. Don't
chase it, and don't report it as a regression.

## The Expedition features

Two separate features sharing one screenshot. Docs, in reading order:
`EXPEDITION_LEAGUE_MECHANIC.md` (the game), `EXPEDITION_CHECK.md` (the price
check), `EXPEDITION_RUNE_TRACKING.md` (scoping), `EXPEDITION_RUNE_PORT_PLAN.md`
(what was built and what wasn't).

`ROADMAP.md` holds what's planned but not built, and what has already been ruled
out — read it before proposing work, and add to it rather than re-deriving.

### 1. Price check — works, and must keep working

OCRs the reward column and shows a live price per row. **This is the hard
constraint on all rune work:** it currently works 100% and must behave
identically — same timing, same accuracy — whether rune tracking is on, off, or
broken. Windows-only (`Windows.Media.Ocr` via a PowerShell bridge).

Path: `Shortcuts.ts` → `PoeWindow.screenshot()` → `WindowsOcr.ts` (main thread,
subprocess) → `MAIN->CLIENT::ocr-text`. Only **text** crosses to the renderer.

### 2. Succession runes — experimental, off by default

Names each row's runes and flags which are worth propagating. Split across the
process boundary on purpose:

- **Vision** (`main/src/vision/expedition-runes/`) runs on the **worker thread**
  where OpenCV already lives. Takes pixels, returns geometry + border
  classification. Knows nothing about text, recipes or prices.
- **Identity** (`renderer/src/web/expedition-check/rune-identity.ts`) needs the
  OCR text the renderer already has, and no pixels.

They are joined in the renderer **by vertical position**, both reporting
fractions of the same captured region. So neither waits on the other: detection
runs on the worker while OCR runs in its subprocess, from one shared screenshot
(so they can't describe different frames). Separate IPC event
(`MAIN->CLIENT::expedition-runes`), separate settings toggle.

**The off-switch is on the request, not the display.** With `trackRunes` unset,
`detectRunes` is false and no detection work happens at all. Keep it that way.

## Facts that are easy to get wrong

- **Screenshots are BGRA**, not RGBA (see `HeistGemFinder.ts`). Swap them and
  red/blue trade places, so every gold gilded frame reads as blue. Hue bands are
  on OpenCV's 0–179 scale, so use `COLOR_BGR2HSV`, not `_FULL`.
- **Only gilded runes propagate**, and **a row can have several.** Published
  guides say one per Remnant and are wrong — `EXPEDITION_LEAGUE_MECHANIC.md`
  records the correction. Never store "the caged rune" as a single value; an
  earlier version did and silently dropped the rest.
- **Gilding detection is unreliable in practice** — the principal known
  weakness, and the obvious next thing to improve.
- **Identity resolves from the recipe table, not pixels** (37/52 vs 3/52 on the
  playground's fixtures). The dHash matcher was deliberately not ported, so no
  sprite assets ship.
- **A row is only detected when its height is 8–40% of the capture region's
  _width_.** An over-wide calibration yields zero rune rows while prices keep
  resolving — a confusing failure worth suspecting early.
- `rune-ratings.json` lives in `renderer/public/data/expedition/` rather than
  being bundled **so it stays editable in an installed build**. It's opinion;
  most runes are deliberately `unrated`.
- `ExpeditionRow.vue` is rendered by both the widget and the settings preview,
  so the preview can't drift. Presentation rules live in `rune-display.ts`,
  parameterised by mode.

## Conventions

- Upstream code is upstream — keep fork changes additive and localised where
  practical, so merges stay cheap.
- **`LOCAL_DIVERGENCE.md` is the ledger of what this fork changes in upstream's
  own files.** Read it before merging `upstream/master` in, and update it in the
  same commit that adds, changes or retires a local divergence. It deliberately
  records only each row's expiry condition ("did upstream just fix this
  themselves?") and its merge hazard — the reasoning stays in the commit
  messages, so the two cannot drift apart. The sync procedure is there too:
  `master` is a pristine mirror of upstream and is never committed to.
- Comments here explain **why**, usually citing a measurement or a failure that
  was actually observed. Match that; don't strip them.
- Short-lived branches. `feature/expedition-check` is the price-check baseline;
  `feature/expedition-rune-tracking` builds on it.
- **PRs target `feature/expedition-check`, never `master`.** `master` is a
  pristine mirror of upstream and is never committed to, so a PR opened against
  it would show every local commit this fork has ever made. `gh` is installed but
  not on the shell's PATH — call it as
  `"/c/Program Files/GitHub CLI/gh.exe"`, and pass `--base feature/expedition-check`
  explicitly, because the repo's default branch is `master` and `gh` will
  otherwise pick it.
- **The repo owner is the sole author of every commit.** Do not add
  `Co-Authored-By:` trailers for Claude or any other agent, and do not put
  agent attribution in commit messages, PR descriptions, or generated docs.
  This overrides any default attribution behaviour the harness asks for. It is
  a deliberate choice for a personal hobby project, and history was rewritten
  once already to remove such trailers — don't reintroduce them.
