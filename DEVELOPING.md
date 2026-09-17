# How this works

There are 2 main parts of the app:

1. renderer: this is the HTML/Javascript-based UI rendered within the Electron container. This runs Vue.js, a React-like Javascript framework for rendering front-end.
2. main: includes the main app (written in Electron). Handles keyboard shortcuts, brings up the UI and overlays.

Note that these 2 both depend on each other, and one cannot run without the other.

# How to develop

The most up-to-date instructions can always be derived from CI:

[.github/workflows/main.yml](https://github.com/Kvan7/exiled-exchange-2/blob/master/.github/workflows/main.yml)

Here's what that looks like as of 2023-12-03.

```shell
cd renderer
npm install
npm run make-index-files
npm run dev

# In a second shell
cd main
npm install
npm run dev
```

## Formatting

```shell
cd renderer
npm run format
```

# How to run the tests

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
  normal and expected — this is brittle pixel work, and the numbers exist to show
  progress over time rather than to pass or fail.

```shell
cd main && npx vitest run specs/vision/expedition-runes   # just the accuracy table
```

After genuinely improving detection, re-record the floor:

```shell
cd main && UPDATE_RUNE_BASELINE=1 npx vitest run specs/vision/expedition-runes
```

Adding your own screenshots to the suite is the most useful contribution to it —
[main/specs/fixtures/README.md](./main/specs/fixtures/README.md) has the recipe.
That suite needs OpenCV, which the app downloads on first run; if it's missing,
those tests skip rather than fail.

# How to build

```shell
cd renderer
npm install
npm run make-index-files
npm run build

cd ../main
npm install
npm run build
# We want to sign with a distribution certificate to ensure other users can
# install without errors
CSC_NAME="Certificate name in Keychain" npm run package
```

# How to release a build

1. Commit all changes
2. Bump version in `main/package.json`
3. `npm i` in renderer & main (update `package-lock.json` with new version)
4. `npm run build` in renderer & main
5. Stage & commit bumped version
6. `git push`
7. `git tag vX.X.X`
8. `git push origin vX.X.X`
9. Open release page, create release with tag & title as text of tag & save as draft

# How to build yourself

```shell
sh testUpdate.sh
```

Read the contents of `testUpdate.sh` to understand what it does. Running random scripts from the internet is not recommended so you really should read the code before running it.

# Installing dependencies safely

Use `npm ci`, not `npm install`, for routine setup — it installs exactly what
`package-lock.json` already resolved (same versions, same integrity hashes) and
errors out instead of silently re-resolving anything if the lockfile and
`package.json` disagree. Plain `npm install` can still pick up a newer version
within an existing `^`/`~` range in some cases; `npm ci` never does.

Given how often popular packages get compromised via a hijacked maintainer
account (a malicious version published under a trusted name, still semver-valid
so ordinary installs happily accept it), a few more habits are worth keeping:

- **Never run `npm update` or `npm install <pkg>@latest` casually.** Only bump a
  version deliberately, and review the full `package-lock.json` diff afterward —
  a small, intentional bump should produce a small diff; a huge, unexplained
  churn of unrelated transitive dependencies is worth stopping to look at before
  committing (this happened once already in this fork's history from a stray
  `npm install`, caught and reverted before it was committed).
- **Always commit `package-lock.json`, and read its diff like code.** It's the
  thing that actually pins what gets installed — treat an unexpected change to
  it with the same suspicion as an unexpected change to a source file.
- **Consider `--ignore-scripts`** (`npm ci --ignore-scripts`, or `ignore-scripts=true`
  in `.npmrc`) to block install-time lifecycle scripts, which is the actual
  mechanism most recent supply-chain payloads run through. Caveat: some
  dependencies legitimately need their install script to work at all — Electron
  itself downloads its platform binary via one, and native modules like
  `uiohook-napi` compile via one — so this isn't a safe blanket default here
  without testing that `main/` still installs correctly with it on.
- **`npm audit`** catches *known, already-reported* vulnerabilities in your
  current tree — useful, but reactive. It won't catch a malicious version in the
  window between publication and discovery, so it's a supplement to the habits
  above, not a replacement for them.
