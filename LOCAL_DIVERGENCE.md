# Local divergence from upstream

Upstream is [Kvan7/Exiled-Exchange-2](https://github.com/Kvan7/Exiled-Exchange-2).
This fork tracks it closely and is meant to keep doing so.

**What this file is for.** When a merge from upstream conflicts, the question is
never "what does my change do" — the commit messages and the comments in the code
carry that, deliberately. The question is *"is my change still needed, or did
upstream just fix this themselves?"* That is the only thing this file answers.
A row is deleted the moment its divergence goes away.

So: no reasoning here that a commit message already carries. Point at the commit.

## Syncing

One-time:

```sh
git remote add upstream https://github.com/Kvan7/Exiled-Exchange-2.git
```

Then, whenever upstream moves:

```sh
git fetch upstream
git switch master && git merge --ff-only upstream/master   # master is a pristine mirror
git switch feature/expedition-check && git merge master
```

- **Never commit to `master`.** It exists so that `origin/master...HEAD` always
  means "everything that is mine". Several commands below rely on that.
- **Merge, never rebase.** The divergence is ~23 commits; a rebase re-resolves
  every conflict every time, a merge resolves each one once and remembers it.
- After any merge that touched `renderer/public/data/`, run
  `cd renderer && npm run make-index-files`. The `*.index.bin` files are
  gitignored and rebuilt from the `.ndjson`, so they are never a conflict — but a
  stale index silently breaks mod recognition, which looks like a parser bug.

## Where a conflict can happen at all

Most of this fork is new files, which upstream cannot conflict with. Only the
files below are *modifications* to upstream's own:

```sh
git diff --numstat --diff-filter=M origin/master...HEAD
```

Keep it that way where there's a choice: a change that lives in a new file, or in
code rather than in generated data, costs nothing at merge time.

## The ledger

### 1. Signed-placeholder stat matching

- **Files:** `renderer/src/parser/stat-translations.ts`, `renderer/specs/Parser/stat-translation.test.ts`
- **Commit:** `061a35c3`
- **Why it exists:** the parser folds a roll's `+` into the `#` placeholder, so
  the ~10 matchers that keep a mid-line `+` were unreachable and read as
  "Not recognized modifier" (two Expedition tablet suffixes among them).
- **Drop it when:** upstream fixes the leading-only `+` strip in
  `dataParser/src/stores/helpers/description.py` *and* the data is regenerated,
  or upstream normalizes `+#` → `#` in the parser or in `TradeData.ts`. Check
  with `grep -c '"string": "[^"]*+#' renderer/public/data/en/stats.ndjson`.
- **Careful:** this has two halves that can expire separately. Fixed data kills
  the need for the bundled-data retry; it does *not* kill the need for the
  trade-fallback retry, because GGG's own trade texts keep the `+` and a mod
  missing from `stats.ndjson` can only come from there.
- **Status:** unit-tested and confirmed against real bundled data for the first
  mod. The trade-fallback half has not been run in the app against the live
  endpoint.

### 2. Magic tablets can be narrowed to magic-only

- **Files:** `renderer/src/web/price-check/filters/create-stat-filters.ts`
- **Commit:** `49c9a080` (merged as `ec9dea66`)
- **Why it exists:** upstream deliberately searches `rarity: nonunique` for magic
  tablets and offers no way to narrow it, so a magic-vs-magic comparison is
  diluted by rares. This adds the opt-in `item.rarity_magic` chip.
- **Drop it when:** upstream exposes tablet rarity in the UI, makes the rarity
  chip in `FiltersBlock.vue` interactive, or removes the `ItemCategory.Tablet`
  carve-out in `create-item-filters.ts`.
- **Careful:** the placement is load-bearing, not incidental — it must stay
  *after* the `enableAllFilters()` calls at the end of `createExactStatFilters`,
  or `defaultAllSelected` will silently lock tablet searches to magic. If
  upstream restructures that function's tail, re-check the ordering.
- **Status:** typechecks and lints; behaviour in game not verified by me.

### 3. Expedition Price Check

- **Files:** 33 new files (`renderer/src/web/expedition-check/`,
  `main/src/vision/`, `renderer/public/data/expedition/`, specs) plus additive
  hooks into upstream files: `ipc/types.ts`, `main/src/shortcuts/Shortcuts.ts`,
  `main/src/vision/link-{main,worker}.ts`, `main/src/vision/utils.ts`,
  `main/build/script.mjs`, `renderer/src/web/Config.ts`,
  `renderer/src/web/overlay/widgets.ts`, `.../widget-registry.ts`,
  `renderer/src/web/background/Prices.ts`,
  `renderer/src/web/settings/SettingsWindow.vue`
- **Commits:** `git log --oneline origin/master..HEAD --grep=Expedition`
- **Why it exists:** it is the reason this fork exists. See `EXPEDITION_CHECK.md`,
  `EXPEDITION_LEAGUE_MECHANIC.md`, `EXPEDITION_RUNE_TRACKING.md`.
- **Drop it when:** never, unless upstream ships the same feature.
- **Careful:** every hook into an upstream file is an *added registration* —
  a widget entry, a shortcut, an IPC type, a config default. On a conflict, re-add
  the entry on top of upstream's version; never resolve by taking a whole hunk
  from either side, because that is how a registration goes missing silently.
  `Shortcuts.ts` and `widgets.ts` are the two upstream edits most often.

### 3b. A test runner in `main/`

- **Files:** `main/package.json` (one `devDependencies` entry, one `scripts`
  entry), `main/package-lock.json`, plus new files upstream has no opinion about:
  `main/vitest.config.mts` and everything under `main/specs/`.
- **Why it exists:** upstream's `main` package has no tests at all, so the whole
  vision layer — row/cell detection, border classification, the OCR quantity-prefix
  repair — had no coverage anywhere. The renderer's vitest could not host them:
  reaching across packages would drag `main`'s `electron` imports into the
  renderer's suite.
- **Drop it when:** upstream adds its own test runner to `main` — then keep the
  specs and delete the config, taking upstream's runner.
- **Careful:** the `package.json` change is purely additive (`vitest` in
  `devDependencies`, `"test": "vitest"` in `scripts`). On a conflict, re-add those
  two lines on top of upstream's version rather than taking either side whole. The
  lockfile will conflict on any upstream dependency change; regenerate it with
  `npm install --legacy-peer-deps` rather than merging it by hand (plain
  `npm install` fails on this tree with an `edgesOut` error from npm's own
  `overrides` handling).
- **Status:** 31 tests pass; `tsc --noEmit` covers the specs and is clean.

### 4. `expedition_check` strings in `app_i18n.json`

- **Files:** `renderer/public/data/en/app_i18n.json` (+27, one contiguous block)
- **Why it exists:** the widget's UI strings have to live where the app loads
  strings from.
- **This is the one local edit to generated, tracked data**, so it is the one row
  expected to conflict on a routine upstream data refresh. On conflict: keep the
  `expedition_check` block, take upstream's version of everything else in the
  file. Keeping it as a single contiguous block is what makes that a 10-second
  resolution — don't scatter the keys.
- **If it ever stops being cheap:** move these strings out of the generated file
  and register them from the widget's own code instead.

### 5. Documentation

- **Files:** `README.md` (+200/-11) and local-only docs — `CLAUDE.md`,
  `AI_POLICY.md`, `EXPEDITION_*.md`, this file.
- **Careful:** `README.md` is the only one upstream also edits. On conflict, keep
  the local showcase screenshots and settings reference; take upstream's install,
  build and troubleshooting sections.

## When a conflict hits

1. Find the row above for the file.
2. Ask its **Drop it when** question first. If upstream solved the problem, delete
   the local change and the row — that is the cheapest possible outcome and the
   whole point of keeping this file.
3. Otherwise re-apply the local intent on top of upstream's new code, honour the
   **Careful** note, and verify the specific behaviour the commit message claims.
4. Update the row if the shape of the divergence changed.
